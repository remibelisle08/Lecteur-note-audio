import type { Library } from '../library/db';
import type { Chapter } from '../types';
import type { DriveClient } from './driveClient';
import { SyncEngine, type SyncStatus } from './syncEngine';

export type DriveState = { configured: boolean; connected: boolean; status: SyncStatus };

/** Pilotage de la synchro Drive pour l'interface (connexion, état, synchro manuelle). */
export interface DriveControl {
  getState(): DriveState;
  subscribe(l: () => void): () => void;
  connect(): Promise<void>;
  disconnect(): void;
  syncNow(): Promise<void>;
  /** Audio d'un chapitre depuis Drive (lecteur), `undefined` si indisponible. */
  fetchRemoteAudio(ch: Chapter): Promise<Blob | undefined>;
}

const LAST_SYNC_KEY = 'lecteur-notes.drive-last-sync';

function readLastSync(): number | undefined {
  try {
    const v = Number(localStorage.getItem(LAST_SYNC_KEY));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/** `client` absent (pas d'ID client OAuth) → synchro non configurée, tout est inerte. */
export function createDriveSync(lib: Library, client: DriveClient | null): DriveControl {
  const listeners = new Set<() => void>();
  let state: DriveState = {
    configured: !!client,
    connected: false,
    status: { state: 'idle', lastSyncAt: client ? readLastSync() : undefined },
  };
  let engine: SyncEngine | undefined;
  let unsubEngine: (() => void) | undefined;

  const set = (patch: Partial<DriveState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  function startEngine(c: DriveClient) {
    engine = new SyncEngine(lib, c.api, () => lib.getSettings());
    unsubEngine = engine.onStatus((status) => {
      const lastSyncAt = status.lastSyncAt ?? state.status.lastSyncAt;
      if (status.lastSyncAt) {
        try {
          localStorage.setItem(LAST_SYNC_KEY, String(status.lastSyncAt));
        } catch {
          /* ignoré */
        }
      }
      set({ status: { ...status, lastSyncAt } });
    });
    set({ connected: true });
    engine.start();
  }

  if (client?.isConnected()) startEngine(client);

  return {
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    async connect() {
      if (!client) return;
      await client.connect();
      if (engine) await engine.syncNow();
      else startEngine(client);
    },
    disconnect() {
      if (!client) return;
      engine?.stop();
      unsubEngine?.();
      engine = undefined;
      unsubEngine = undefined;
      client.disconnect();
      set({ connected: false, status: { state: 'idle', lastSyncAt: state.status.lastSyncAt } });
    },
    async syncNow() {
      await engine?.syncNow();
    },
    async fetchRemoteAudio(ch) {
      if (!client?.isConnected() || !ch.audioDriveId) return undefined;
      try {
        return await client.api.downloadAudio(ch.audioDriveId);
      } catch {
        return undefined;
      }
    },
  };
}
