import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMultipartBody,
  createDriveClient,
  DriveAuthError,
  fileInFolderQuery,
  folderQuery,
  listFilesParams,
  TOKEN_TIMEOUT_MS,
} from '../../src/sync/driveClient';

const TOKEN_KEY = 'lecteur-notes.drive-token';
const LINKED_KEY = 'lecteur-notes.drive-linked';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.google;
  localStorage.clear();
});

/** Google Identity factice : enregistre les demandes, la réponse est donnée par le test. */
function fakeGis() {
  const requests: ({ prompt?: string } | undefined)[] = [];
  let callback!: (r: { access_token?: string; expires_in?: number }) => void;
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg) => {
          callback = cfg.callback;
          return { requestAccessToken: (o) => requests.push(o) };
        },
        revoke: vi.fn(),
      },
    },
  };
  return { requests, respond: (token: string) => callback({ access_token: token, expires_in: 3600 }) };
}

const res = (status: number, body: unknown = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

describe('driveClient — fonctions pures', () => {
  it('requête du dossier « Lecteur de notes »', () => {
    expect(folderQuery()).toBe(
      "name='Lecteur de notes' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    );
  });

  it('requête d’un fichier par nom dans le dossier (apostrophes échappées)', () => {
    expect(fileInFolderQuery('library.json', 'abc')).toBe("name='library.json' and 'abc' in parents and trashed=false");
    expect(fileInFolderQuery("l'x", 'abc')).toBe("name='l\\'x' and 'abc' in parents and trashed=false");
  });

  it('files.list : le plus ancien correspondant', () => {
    const p = new URLSearchParams(listFilesParams(folderQuery()));
    expect(p.get('q')).toBe(folderQuery());
    expect(p.get('orderBy')).toBe('createdTime');
    expect(p.get('pageSize')).toBe('1');
    expect(p.get('fields')).toBe('files(id)');
  });

  it('corps multipart : métadonnées JSON puis contenu', async () => {
    const { body, contentType } = buildMultipartBody(
      { name: 'chapter-1.mp3', parents: ['f'] },
      new Blob(['DATA'], { type: 'audio/mpeg' }),
      'audio/mpeg',
      'BOUNDARY',
    );
    expect(contentType).toBe('multipart/related; boundary=BOUNDARY');
    expect(await readText(body)).toBe(
      '--BOUNDARY\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        '{"name":"chapter-1.mp3","parents":["f"]}\r\n' +
        '--BOUNDARY\r\nContent-Type: audio/mpeg\r\n\r\nDATA\r\n--BOUNDARY--',
    );
  });

  it('DriveAuthError est une Error identifiable', () => {
    const e = new DriveAuthError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('DriveAuthError');
  });
});

describe('createDriveClient', () => {
  const storeToken = () =>
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: 'tok', expiresAt: Date.now() + 3600_000 }));

  it('401 → DriveAuthError et jeton oublié', async () => {
    storeToken();
    localStorage.setItem(LINKED_KEY, '1');
    const fetchMock = vi.fn(async () => res(401));
    vi.stubGlobal('fetch', fetchMock);
    const client = createDriveClient('client-id');
    await expect(client.api.ensureFolder()).rejects.toBeInstanceOf(DriveAuthError);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith('https://www.googleapis.com/drive/v3/files?')).toBe(true);
    expect(url).toContain('orderBy=createdTime');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('suppression : 404 ignoré, autre erreur propagée', async () => {
    storeToken();
    const fetchMock = vi.fn(async () => res(404));
    vi.stubGlobal('fetch', fetchMock);
    const client = createDriveClient('client-id');
    await expect(client.api.deleteFile('f1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]).toEqual([
      'https://www.googleapis.com/drive/v3/files/f1',
      expect.objectContaining({ method: 'DELETE' }),
    ]);
    fetchMock.mockImplementationOnce(async () => res(500));
    await expect(client.api.deleteFile('f1')).rejects.toThrow('500');
  });

  it('sans réponse de Google Identity en 60 s → DriveAuthError', async () => {
    vi.useFakeTimers();
    const gis = fakeGis();
    const client = createDriveClient('client-id');
    const p = client.connect();
    const assertion = expect(p).rejects.toBeInstanceOf(DriveAuthError);
    await vi.advanceTimersByTimeAsync(TOKEN_TIMEOUT_MS - 1);
    expect(gis.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(client.isConnected()).toBe(false);
  });

  it('connexion interactive : ne réutilise pas un renouvellement silencieux en cours', async () => {
    vi.useFakeTimers();
    localStorage.setItem(LINKED_KEY, '1'); // relié, jeton expiré → renouvellement silencieux
    const gis = fakeGis();
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { files: [{ id: 'folder' }] })));
    const client = createDriveClient('client-id');
    const silent = client.api.ensureFolder();
    const silentAssertion = expect(silent).rejects.toBeInstanceOf(DriveAuthError);
    await vi.advanceTimersByTimeAsync(0);
    expect(gis.requests).toEqual([{ prompt: '' }]);

    const interactive = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(gis.requests).toEqual([{ prompt: '' }, undefined]);
    await silentAssertion; // remplacée par la demande interactive
    gis.respond('nouveau');
    await expect(interactive).resolves.toBeUndefined();
    expect(client.isConnected()).toBe(true);
    await expect(client.api.ensureFolder()).resolves.toBe('folder');
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY)!).token).toBe('nouveau');
  });
});
