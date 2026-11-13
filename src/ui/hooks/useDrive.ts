import { useSyncExternalStore } from 'react';
import type { DriveControl, DriveState } from '../../sync/driveSync';

const NOT_CONFIGURED: DriveState = { configured: false, connected: false, status: { state: 'idle' } };
const noop = () => () => undefined;

/** État de la synchro Drive (non configurée si aucun pilote n'est fourni). */
export function useDriveState(drive: DriveControl | undefined): DriveState {
  return useSyncExternalStore(
    drive ? drive.subscribe : noop,
    drive ? drive.getState : () => NOT_CONFIGURED,
  );
}
