import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ImportResult } from '../import';
import type { Library } from '../library/db';
import type { DriveControl } from '../sync/driveSync';
import type { PlayerController } from '../player/controller';
import type { TtsEngine } from '../tts/engine';
import type { Generator } from '../tts/generator';
import { generationStoreFor, type GenerationStore } from './generationStore';
import { Toasts, type Toast } from './components/Toasts';
import { useDriveState } from './hooks/useDrive';

export type ImportFn = (
  file: File,
  onProgress?: (msg: string, ratio: number) => void,
  opts?: { forceOcr?: boolean },
) => Promise<ImportResult>;

export type GeneratorLike = Pick<Generator, 'generateNote' | 'onProgress' | 'busy' | 'isQueued'>;
export type PlayerLike = Pick<
  PlayerController,
  'unlock' | 'loadNote' | 'loadCourse' | 'play' | 'pause' | 'seekBy' | 'seekTo' | 'next' | 'prev' | 'goTo' | 'setRate' | 'subscribe'
>;

/** Services de l'application, créés une seule fois au démarrage (voir services.ts). */
export interface AppServices {
  lib: Library;
  generator: GeneratorLike;
  player: PlayerLike;
  /** Import du document (module chargé à la demande). */
  importFile: ImportFn;
  /** Moteur vocal par voix (le même que celui du générateur). */
  getEngine: (voiceId: string) => Promise<TtsEngine>;
  /** Avancement du téléchargement de la voix (0–1). */
  onVoiceDownload?: (l: (ratio: number) => void) => () => void;
  /** Libère le moteur vocal s'il n'est pas celui de `keepVoiceId`. */
  releaseEngines?: (keepVoiceId: string) => void;
  /** Fichiers importés pendant cette session, par note (pour relancer avec l'OCR). */
  sourceFiles: Map<string, File>;
  /** Drive connecté (forcé à vrai ; sinon déduit de `drive`). */
  driveConnected: boolean;
  /** Synchro Google Drive (absente → non configurée). */
  drive?: DriveControl;
}

export type AppContextValue = AppServices & {
  generation: GenerationStore;
  /** Affiche un message temporaire (toast). */
  notify(message: string): void;
};

const Ctx = createContext<AppContextValue | null>(null);


export function AppProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const generation = generationStoreFor(services.generator);
  const driveState = useDriveState(services.drive);
  const driveConnected = services.driveConnected || driveState.connected;

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (message: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t.filter((x) => x.message !== message), { id, message }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({ ...services, driveConnected, generation, notify }),
    [services, driveConnected, generation, notify],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp() hors de <AppProvider>');
  return v;
}
