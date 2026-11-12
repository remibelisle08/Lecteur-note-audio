import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { makeServices, openTestLibrary, renderAt } from './helpers';
import type { DriveControl, DriveState } from '../../src/sync/driveSync';
import { formatSyncTime } from '../../src/ui/format';

function fakeDrive(initial: Partial<DriveState> = {}) {
  let state: DriveState = { configured: true, connected: false, status: { state: 'idle' }, ...initial };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<DriveState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const drive = {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    connect: vi.fn(async () => set({ connected: true })),
    disconnect: vi.fn(() => set({ connected: false })),
    syncNow: vi.fn(async () => undefined),
    fetchRemoteAudio: vi.fn(async () => undefined),
  } satisfies DriveControl;
  return { drive, set };
}

const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

describe('Réglages — section Google Drive', () => {
  it('non configurée → explication, aucun bouton', async () => {
    const lib = await openTestLibrary();
    renderAt('#/settings', makeServices(lib));
    expect(
      await screen.findByText("La synchro Drive n'est pas configurée sur cette installation (voir README)."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connecter Google Drive' })).toBeNull();
    expect(screen.queryByRole('button', { name: "Libérer l'audio des notes écoutées" })).toBeNull();
  });

  it('déconnectée → « Connecter Google Drive » ; une fois connectée, état et actions', async () => {
    const lib = await openTestLibrary();
    const { drive, set } = fakeDrive();
    renderAt('#/settings', makeServices(lib, { drive }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter Google Drive' }));
    expect(drive.connect).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('Pas encore synchronisé.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Libérer l'audio des notes écoutées" })).toBeInTheDocument();

    act(() => set({ status: { state: 'idle', lastSyncAt: at(14, 32) } }));
    expect(screen.getByText('Dernière synchro : 14 h 32')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }));
    expect(drive.syncNow).toHaveBeenCalledTimes(1);

    act(() => set({ status: { state: 'syncing', lastSyncAt: at(14, 32) } }));
    expect(screen.getByText('Synchronisation en cours…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Synchroniser maintenant' })).toBeDisabled();

    act(() =>
      set({ status: { state: 'error', message: 'Le fichier de synchro sur Drive est illisible. Rien n’a été modifié.' } }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Le fichier de synchro sur Drive est illisible.');

    fireEvent.click(screen.getByRole('button', { name: 'Déconnecter' }));
    expect(drive.disconnect).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Connecter Google Drive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Libérer l'audio des notes écoutées" })).toBeNull();
  });

  it('échec de connexion → message', async () => {
    const lib = await openTestLibrary();
    const { drive } = fakeDrive();
    drive.connect.mockRejectedValueOnce(new Error('popup fermée'));
    renderAt('#/settings', makeServices(lib, { drive }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter Google Drive' }));
    expect(await screen.findByText('Connexion à Google Drive impossible. Réessaie.')).toBeInTheDocument();
  });
});

describe('Bandeau « Reconnecter Drive »', () => {
  it('affiché quand l’autorisation a expiré, sur tous les écrans', async () => {
    const lib = await openTestLibrary();
    const { drive, set } = fakeDrive({ connected: true });
    renderAt('#/', makeServices(lib, { drive }));
    await screen.findByRole('heading', { name: 'Mes cours' });
    expect(screen.queryByRole('button', { name: 'Reconnecter Drive' })).toBeNull();

    act(() => set({ status: { state: 'auth-required', message: 'expirée' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Reconnecter Drive' }));
    expect(drive.connect).toHaveBeenCalledTimes(1);
  });
});

describe('formatSyncTime', () => {
  it('heure du jour en français, date sinon', () => {
    const now = new Date(2026, 10, 12, 18, 0).getTime();
    expect(formatSyncTime(new Date(2026, 10, 12, 14, 32).getTime(), now)).toBe('14 h 32');
    expect(formatSyncTime(new Date(2026, 10, 12, 9, 5).getTime(), now)).toBe('9 h 05');
    expect(formatSyncTime(new Date(2026, 10, 11, 14, 32).getTime(), now)).toMatch(/^11 nov\.? à 14 h 32$/);
  });
});
