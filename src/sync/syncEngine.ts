import type { ChangeKind, Library } from '../library/db';
import type { Chapter, Settings, Snapshot } from '../types';
import { DriveAuthError, type DriveApi } from './driveClient';

export type SyncStatus = { state: 'idle' | 'syncing' | 'error' | 'auth-required'; lastSyncAt?: number; message?: string };
export type SyncResult = { ok: boolean; uploaded: number; downloaded: number; deleted: number };

export const CORRUPT_MESSAGE = 'Le fichier de synchro sur Drive est illisible. Rien n’a été modifié.';
export const AUTH_MESSAGE = 'La connexion à Google Drive a expiré. Reconnecte-toi pour reprendre la synchro.';
export const FAILED_MESSAGE = 'La synchro Drive a échoué (connexion ?). Nouvel essai plus tard.';

/** Agrégation des modifications de la bibliothèque. */
export const LIBRARY_DEBOUNCE_MS = 5_000;
/** Pendant l'écoute, la position est synchronisée au plus toutes les 30 s. */
export const PROGRESS_INTERVAL_MS = 30_000;

class CorruptRemoteError extends Error {}

function parseSnapshot(raw: string): Snapshot {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new CorruptRemoteError();
  }
  const s = data as Partial<Snapshot> | null;
  const arrays = ['courses', 'notes', 'chapters', 'progress', 'tombstones'] as const;
  if (!s || typeof s !== 'object' || s.version !== 1 || arrays.some((k) => !Array.isArray(s[k]))) {
    throw new CorruptRemoteError();
  }
  return s as Snapshot;
}

const EMPTY: Snapshot = { version: 1, courses: [], notes: [], chapters: [], progress: [], tombstones: [] };

/**
 * Synchronise la bibliothèque locale avec le dossier Drive : lecture du distant, fusion, application locale,
 * transferts audio, puis écriture de `library.json` (en dernier : un échec en route ne publie rien).
 */
export class SyncEngine {
  private status: SyncStatus = { state: 'idle' };
  private listeners = new Set<(s: SyncStatus) => void>();
  private running?: Promise<SyncResult>;
  private queued?: Promise<SyncResult>;
  /** > 0 pendant les écritures de la synchro elle-même : leurs notifications ne relancent pas de synchro. */
  private selfWrites = 0;
  private started = false;
  private unsubLib?: () => void;
  private libraryTimer?: ReturnType<typeof setTimeout>;
  private progressTimer?: ReturnType<typeof setTimeout>;
  private lastTriggerAt = -Infinity;

  constructor(
    private lib: Library,
    private api: DriveApi,
    private getSettings: () => Promise<Settings>,
  ) {}

  onStatus(l: (s: SyncStatus) => void): () => void {
    this.listeners.add(l);
    l(this.status);
    return () => {
      this.listeners.delete(l);
    };
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  private setStatus(s: SyncStatus) {
    this.status = s;
    this.listeners.forEach((l) => l(s));
  }

  /** Une seule synchro à la fois ; les demandes faites pendant une synchro en déclenchent une seule après. */
  syncNow(): Promise<SyncResult> {
    if (!this.running) return this.launch();
    this.queued ??= this.running.then(() => {
      this.queued = undefined;
      return this.launch();
    });
    return this.queued;
  }

  private launch(): Promise<SyncResult> {
    const p = this.run().finally(() => {
      if (this.running === p) this.running = undefined;
    });
    this.running = p;
    return p;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', this.onOnline);
    this.unsubLib = this.lib.onChange(this.onLibChange);
    this.trigger();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('online', this.onOnline);
    this.unsubLib?.();
    this.unsubLib = undefined;
    clearTimeout(this.libraryTimer);
    clearTimeout(this.progressTimer);
    this.libraryTimer = undefined;
    this.progressTimer = undefined;
  }

  private trigger() {
    this.lastTriggerAt = Date.now();
    void this.syncNow();
  }

  private onOnline = () => this.trigger();

  private onLibChange = (kind: ChangeKind) => {
    if (this.selfWrites > 0 || !this.started) return;
    if (kind === 'library') {
      clearTimeout(this.libraryTimer);
      this.libraryTimer = setTimeout(() => {
        this.libraryTimer = undefined;
        this.trigger();
      }, LIBRARY_DEBOUNCE_MS);
    } else if (this.progressTimer === undefined) {
      const delay = Math.max(0, this.lastTriggerAt + PROGRESS_INTERVAL_MS - Date.now());
      this.progressTimer = setTimeout(() => {
        this.progressTimer = undefined;
        this.trigger();
      }, delay);
    }
  };

  private async selfWrite<T>(fn: () => Promise<T>): Promise<T> {
    this.selfWrites++;
    try {
      return await fn();
    } finally {
      this.selfWrites--;
    }
  }

  private async run(): Promise<SyncResult> {
    const result: SyncResult = { ok: false, uploaded: 0, downloaded: 0, deleted: 0 };
    const lastSyncAt = this.status.lastSyncAt;
    this.setStatus({ state: 'syncing', lastSyncAt });
    try {
      const folderId = await this.api.ensureFolder();
      const raw = await this.api.readLibrary(folderId);
      const remote = raw === null ? EMPTY : parseSnapshot(raw);

      // Fusion dans une seule transaction locale : les écritures concurrentes ne sont pas écrasées.
      const { local, merged } = await this.selfWrite(() => this.lib.mergeRemote(remote));

      // Audio Drive des chapitres supprimés (connus d'un côté, absents de la fusion).
      const kept = new Set(merged.chapters.map((c) => c.id));
      const toDelete = new Set<string>();
      for (const c of [...local.chapters, ...remote.chapters]) {
        if (c.audioDriveId && !kept.has(c.id)) toDelete.add(c.audioDriveId);
      }
      for (const fileId of toDelete) {
        await this.api.deleteFile(fileId);
        result.deleted++;
      }

      // Téléversements et téléchargements.
      const settings = await this.getSettings();
      const localChapters = new Map<string, Chapter>();
      for (const n of merged.notes) for (const c of await this.lib.listChapters(n.id)) localChapters.set(c.id, c);
      // Les chapitres déjà écoutés ne sont pas retéléchargés (sinon « Libérer l'audio » serait annulé aussitôt).
      const listened = new Set(merged.progress.flatMap((p) => p.completedChapterIds));
      for (const c of localChapters.values()) {
        if (c.audioStatus !== 'ready') continue;
        try {
          if (c.audioLocal && !c.audioDriveId) {
            const blob = await this.lib.getAudio(c.id);
            if (!blob) continue;
            const fileId = await this.api.uploadAudio(folderId, c.id, blob);
            const fresh = (await this.lib.listChapters(c.noteId)).find((x) => x.id === c.id);
            if (fresh) await this.selfWrite(() => this.lib.saveChapter({ ...fresh, audioDriveId: fileId }));
            result.uploaded++;
          } else if (!c.audioLocal && c.audioDriveId && settings.autoDownloadAudio && !listened.has(c.id)) {
            const blob = await this.api.downloadAudio(c.audioDriveId);
            await this.selfWrite(() => this.lib.putAudio(c.id, blob));
            result.downloaded++;
          }
        } catch (err) {
          // Un transfert audio raté n'empêche pas la synchro de la bibliothèque (nouvel essai à la prochaine).
          if (err instanceof DriveAuthError) throw err;
        }
      }

      const final = await this.lib.exportSnapshot();
      const json = JSON.stringify(final);
      if (raw === null || json !== JSON.stringify(remote)) await this.api.writeLibrary(folderId, json);

      result.ok = true;
      this.setStatus({ state: 'idle', lastSyncAt: Date.now() });
    } catch (err) {
      if (err instanceof CorruptRemoteError) this.setStatus({ state: 'error', lastSyncAt, message: CORRUPT_MESSAGE });
      else if (err instanceof DriveAuthError) this.setStatus({ state: 'auth-required', lastSyncAt, message: AUTH_MESSAGE });
      else this.setStatus({ state: 'error', lastSyncAt, message: FAILED_MESSAGE });
    }
    return result;
  }
}
