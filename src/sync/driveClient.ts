/**
 * Client Google Drive minimal (REST v3, appels fetch directs) : jeton OAuth via Google Identity Services,
 * portée `drive.file` uniquement (l'app ne voit que les fichiers qu'elle a créés).
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FOLDER_NAME = 'Lecteur de notes';
export const LIBRARY_FILE = 'library.json';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TOKEN_KEY = 'lecteur-notes.drive-token';
const LINKED_KEY = 'lecteur-notes.drive-linked';
/** Marge avant l'expiration du jeton : on le renouvelle un peu avant. */
const EXPIRY_MARGIN_MS = 60_000;
/** Sans réponse de Google Identity dans ce délai, la demande de jeton échoue. */
export const TOKEN_TIMEOUT_MS = 60_000;

export class DriveAuthError extends Error {
  constructor(message = 'Autorisation Google Drive requise') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

/** Fichier introuvable (404) : identifiant en cache périmé (fichier ou dossier supprimé sur Drive). */
class DriveNotFoundError extends Error {}

export interface DriveApi {
  ensureFolder(): Promise<string>;
  /** Version Drive de library.json (métadonnées seules, sans contenu), ou null s'il n'existe pas. */
  libraryVersion(folderId: string): Promise<string | null>;
  readLibrary(folderId: string): Promise<string | null>;
  /** Écrit library.json et renvoie sa nouvelle version Drive (si connue). */
  writeLibrary(folderId: string, json: string): Promise<string | undefined>;
  uploadAudio(folderId: string, chapterId: string, blob: Blob): Promise<string>;
  downloadAudio(fileId: string): Promise<Blob>;
  deleteFile(fileId: string): Promise<void>;
}

export interface DriveClient {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  api: DriveApi;
}

/* ---------- fonctions pures ---------- */

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export const folderQuery = () => `name=${quote(FOLDER_NAME)} and mimeType='${FOLDER_MIME}' and trashed=false`;

export const fileInFolderQuery = (name: string, folderId: string) =>
  `name=${quote(name)} and ${quote(folderId)} in parents and trashed=false`;

export const audioFileName = (chapterId: string) => `chapter-${chapterId}.mp3`;

/** Paramètres de `files.list` : le plus ancien fichier correspondant (doublons éventuels ignorés). */
export const listFilesParams = (q: string) =>
  new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive', orderBy: 'createdTime', pageSize: '1' }).toString();

export function buildMultipartBody(
  metadata: Record<string, unknown>,
  content: Blob | string,
  contentType: string,
  boundary = `lecteur-${Math.random().toString(36).slice(2)}`,
): { body: Blob; contentType: string } {
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/* ---------- Google Identity Services ---------- */

type TokenResponse = { access_token?: string; expires_in?: number | string; error?: string };
type TokenClient = { requestAccessToken(overrides?: { prompt?: string }): void };
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
};

declare global {
  interface Window {
    google?: Gis;
  }
}

let gisLoading: Promise<Gis> | undefined;
function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  gisLoading ??= new Promise<Gis>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google Identity indisponible')));
    script.onerror = () => {
      gisLoading = undefined;
      script.remove();
      reject(new Error('Chargement de Google Identity impossible'));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

type StoredToken = { token: string; expiresAt: number };

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* stockage indisponible : jeton gardé en mémoire seulement */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignoré */
    }
  },
};

function readStoredToken(): StoredToken | undefined {
  try {
    const t = JSON.parse(storage.get(TOKEN_KEY) ?? 'null') as StoredToken | null;
    return t && typeof t.token === 'string' && typeof t.expiresAt === 'number' ? t : undefined;
  } catch {
    return undefined;
  }
}

/* ---------- client ---------- */

export function createDriveClient(clientId: string): DriveClient {
  let current = readStoredToken();
  let linked = storage.get(LINKED_KEY) === '1';
  let tokenClient: TokenClient | undefined;
  type Pending = { resolve: (t: string) => void; reject: (e: Error) => void };
  let pending: Pending | undefined;
  let silentInflight: Promise<string> | undefined;
  let folderId: string | undefined;
  let libraryFileId: string | undefined;

  async function getTokenClient(): Promise<TokenClient> {
    const gis = await loadGis();
    tokenClient ??= gis.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        const p = pending;
        pending = undefined;
        if (!p) return;
        if (!r.access_token || r.error) return p.reject(new DriveAuthError());
        current = { token: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000 };
        storage.set(TOKEN_KEY, JSON.stringify(current));
        p.resolve(r.access_token);
      },
      error_callback: () => {
        const p = pending;
        pending = undefined;
        p?.reject(new DriveAuthError());
      },
    });
    return tokenClient;
  }

  /**
   * `prompt: ''` = renouvellement silencieux (partagé entre appels concurrents) ; sans prompt = connexion
   * interactive, toujours une nouvelle demande. GIS n'a qu'un rappel : une nouvelle demande remplace
   * (et fait échouer) celle en attente.
   */
  function requestToken(prompt?: string): Promise<string> {
    const silent = prompt === '';
    if (silent && silentInflight) return silentInflight;
    const p = getTokenClient().then(
      (tc) =>
        new Promise<string>((resolve, reject) => {
          pending?.reject(new DriveAuthError());
          const me: Pending = {
            resolve: (t) => {
              clearTimeout(timer);
              resolve(t);
            },
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            },
          };
          const timer = setTimeout(() => {
            if (pending === me) pending = undefined;
            me.reject(new DriveAuthError());
          }, TOKEN_TIMEOUT_MS);
          pending = me;
          tc.requestAccessToken(silent ? { prompt: '' } : undefined);
        }),
    );
    if (!silent) return p;
    silentInflight = p.finally(() => {
      silentInflight = undefined;
    });
    return silentInflight;
  }

  async function getToken(): Promise<string> {
    if (current && current.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return current.token;
    if (!linked) throw new DriveAuthError();
    try {
      return await requestToken(''); // renouvellement silencieux
    } catch {
      throw new DriveAuthError();
    }
  }

  function forgetToken() {
    current = undefined;
    storage.remove(TOKEN_KEY);
  }

  async function request(url: string, init: RequestInit = {}, okStatuses: number[] = []): Promise<Response> {
    const token = await getToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401) {
      forgetToken();
      throw new DriveAuthError();
    }
    if (!res.ok && !okStatuses.includes(res.status)) {
      const message = `Drive : erreur HTTP ${res.status}`;
      throw res.status === 404 ? new DriveNotFoundError(message) : new Error(message);
    }
    return res;
  }

  async function findFile(q: string): Promise<string | undefined> {
    const res = await request(`${API}/files?${listFilesParams(q)}`);
    const data = (await res.json()) as { files?: { id: string }[] };
    return data.files?.[0]?.id;
  }

  type FileMeta = { id: string; version?: string | number };
  const versionOf = (m: FileMeta) => (m.version === undefined ? undefined : String(m.version));

  async function createMultipart(metadata: Record<string, unknown>, content: Blob | string, type: string) {
    const { body, contentType } = buildMultipartBody(metadata, content, type);
    const res = await request(`${UPLOAD}/files?uploadType=multipart&fields=id,version`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
    return (await res.json()) as FileMeta;
  }

  async function updateMedia(fileId: string, content: Blob | string, type: string) {
    const res = await request(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,version`, {
      method: 'PATCH',
      headers: { 'Content-Type': type },
      body: content,
    });
    return (await res.json()) as FileMeta;
  }

  /**
   * Exécute `fn` sur le dossier donné ; sur un 404 (dossier ou library.json supprimé depuis la mise en cache),
   * oublie les identifiants en cache et réessaie une seule fois sur le dossier retrouvé (ou recréé).
   */
  async function retryOnStale<T>(folder: string, fn: (folder: string) => Promise<T>): Promise<T> {
    try {
      return await fn(folder);
    } catch (err) {
      if (!(err instanceof DriveNotFoundError)) throw err;
      folderId = undefined;
      libraryFileId = undefined;
      return fn(await api.ensureFolder());
    }
  }

  const api: DriveApi = {
    async ensureFolder() {
      if (folderId) return folderId;
      folderId = await findFile(folderQuery());
      if (!folderId) {
        const res = await request(`${API}/files?fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
        });
        folderId = ((await res.json()) as { id: string }).id;
      }
      return folderId;
    },
    libraryVersion(folder) {
      return retryOnStale(folder, async (f) => {
        libraryFileId ??= await findFile(fileInFolderQuery(LIBRARY_FILE, f));
        if (!libraryFileId) return null;
        const params = new URLSearchParams({ fields: 'id,version,trashed' }).toString();
        const res = await request(`${API}/files/${encodeURIComponent(libraryFileId)}?${params}`);
        const meta = (await res.json()) as FileMeta & { trashed?: boolean };
        // Mis à la corbeille : traité comme supprimé (le fichier sera retrouvé ou recréé).
        if (meta.trashed) throw new DriveNotFoundError('library.json à la corbeille');
        return versionOf(meta) ?? null;
      });
    },
    readLibrary(folder) {
      return retryOnStale(folder, async (f) => {
        libraryFileId ??= await findFile(fileInFolderQuery(LIBRARY_FILE, f));
        if (!libraryFileId) return null;
        const res = await request(`${API}/files/${encodeURIComponent(libraryFileId)}?alt=media`);
        return res.text();
      });
    },
    writeLibrary(folder, json) {
      return retryOnStale(folder, async (f) => {
        libraryFileId ??= await findFile(fileInFolderQuery(LIBRARY_FILE, f));
        if (libraryFileId) return versionOf(await updateMedia(libraryFileId, json, 'application/json'));
        const created = await createMultipart(
          { name: LIBRARY_FILE, parents: [f], mimeType: 'application/json' },
          json,
          'application/json',
        );
        libraryFileId = created.id;
        return versionOf(created);
      });
    },
    uploadAudio(folder, chapterId, blob) {
      return retryOnStale(folder, async (f) => {
        const name = audioFileName(chapterId);
        const existing = await findFile(fileInFolderQuery(name, f));
        if (existing) {
          await updateMedia(existing, blob, 'audio/mpeg');
          return existing;
        }
        return (await createMultipart({ name, parents: [f], mimeType: 'audio/mpeg' }, blob, 'audio/mpeg')).id;
      });
    },
    async downloadAudio(fileId) {
      const res = await request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
      const data = await res.arrayBuffer();
      return new Blob([data], { type: 'audio/mpeg' });
    },
    async deleteFile(fileId) {
      await request(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, [404]);
    },
  };

  return {
    async connect() {
      await requestToken();
      linked = true;
      storage.set(LINKED_KEY, '1');
    },
    disconnect() {
      const token = current?.token;
      forgetToken();
      linked = false;
      storage.remove(LINKED_KEY);
      folderId = undefined;
      libraryFileId = undefined;
      if (token) window.google?.accounts?.oauth2?.revoke(token);
    },
    isConnected: () => linked,
    api,
  };
}
