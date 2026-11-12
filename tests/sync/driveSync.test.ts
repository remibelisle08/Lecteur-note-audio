import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { openLibrary } from '../../src/library/db';
import { DriveAuthError, type DriveApi, type DriveClient } from '../../src/sync/driveClient';
import { createDriveSync } from '../../src/sync/driveSync';
import type { Chapter } from '../../src/types';

let n = 0;
const openTestLibrary = () => openLibrary(`drivesync-${Date.now()}-${n++}`);

function fakeClient(connected: boolean) {
  let linked = connected;
  const api: DriveApi = {
    ensureFolder: vi.fn(async () => 'f'),
    readLibrary: vi.fn(async () => null),
    writeLibrary: vi.fn(async () => undefined),
    uploadAudio: vi.fn(async () => 'id'),
    downloadAudio: vi.fn(async () => new Blob(['mp3'], { type: 'audio/mpeg' })),
    deleteFile: vi.fn(async () => undefined),
  };
  const client: DriveClient = {
    connect: vi.fn(async () => {
      linked = true;
    }),
    disconnect: vi.fn(() => {
      linked = false;
    }),
    isConnected: () => linked,
    api,
  };
  return { client, api };
}

const ch = { id: 'c', noteId: 'n', audioDriveId: 'file-1' } as Chapter;

describe('createDriveSync', () => {
  it('sans client → non configurée, inerte', async () => {
    const drive = createDriveSync(await openTestLibrary(), null);
    expect(drive.getState()).toMatchObject({ configured: false, connected: false });
    expect(await drive.fetchRemoteAudio(ch)).toBeUndefined();
  });

  it('client déjà relié → synchro démarrée au lancement ; déconnexion → plus de téléchargement', async () => {
    const { client, api } = fakeClient(true);
    const drive = createDriveSync(await openTestLibrary(), client);
    expect(drive.getState().connected).toBe(true);
    await vi.waitFor(() => expect(drive.getState().status.lastSyncAt).toBeGreaterThan(0));
    expect(api.writeLibrary).toHaveBeenCalledTimes(1);

    expect(await drive.fetchRemoteAudio(ch)).toBeInstanceOf(Blob);
    expect(api.downloadAudio).toHaveBeenCalledWith('file-1');

    drive.disconnect();
    expect(client.disconnect).toHaveBeenCalled();
    expect(drive.getState().connected).toBe(false);
    expect(await drive.fetchRemoteAudio(ch)).toBeUndefined();
  });

  it('connect() → relie puis synchronise ; échec de téléchargement → undefined', async () => {
    const { client, api } = fakeClient(false);
    const drive = createDriveSync(await openTestLibrary(), client);
    const seen = vi.fn();
    drive.subscribe(seen);
    await drive.connect();
    expect(drive.getState().connected).toBe(true);
    expect(seen).toHaveBeenCalled();
    await vi.waitFor(() => expect(api.writeLibrary).toHaveBeenCalledTimes(1));
    vi.mocked(api.downloadAudio).mockRejectedValueOnce(new Error('réseau'));
    expect(await drive.fetchRemoteAudio(ch)).toBeUndefined();
    expect(drive.getState().status.state).not.toBe('auth-required');
    drive.disconnect();
  });

  it('fetchRemoteAudio : autorisation expirée → auth-required (bandeau)', async () => {
    const { client, api } = fakeClient(true);
    const drive = createDriveSync(await openTestLibrary(), client);
    await vi.waitFor(() => expect(drive.getState().status.state).toBe('idle'));
    await vi.waitFor(() => expect(api.writeLibrary).toHaveBeenCalled());
    vi.mocked(api.downloadAudio).mockRejectedValueOnce(new DriveAuthError());
    expect(await drive.fetchRemoteAudio(ch)).toBeUndefined();
    expect(drive.getState().status.state).toBe('auth-required');
    drive.disconnect();
  });
});
