import type { Library } from '../library/db';
import { PlayerController } from '../player/controller';
import { bindMediaSession } from '../player/mediaSession';
import { createDriveClient } from '../sync/driveClient';
import { createDriveSync } from '../sync/driveSync';
import { createWorkerEngine, type TtsEngine } from '../tts/engine';
import { Generator } from '../tts/generator';
import type { AppServices, ImportFn } from './AppContext';
import { EngineCache } from './engineCache';
import { generationStoreFor } from './generationStore';

declare global {
  interface Window {
    /** Tests de bout en bout : moteur vocal factice utilisé à la place du worker Piper. */
    __TEST_TTS__?: TtsEngine;
  }
}

/** Le module d'import (pdf.js, mammoth, tesseract) est chargé à la première utilisation. */
const importFile: ImportFn = async (file, onProgress, opts) => (await import('../import')).importFile(file, onProgress, opts);

/** Crée les services de l'app, une seule fois au démarrage : un seul élément <audio>, un seul lecteur. */
export function createServices(lib: Library): AppServices & { generator: Generator } {
  const engines = new EngineCache((voiceId, onDownload) => createWorkerEngine(voiceId, onDownload));
  const getEngine = (voiceId: string): Promise<TtsEngine> => {
    const testEngine = window.__TEST_TTS__;
    return testEngine ? Promise.resolve(testEngine) : engines.get(voiceId);
  };
  const generator = new Generator(lib, getEngine);
  // Abonné tout de suite : les évènements de resumeAll (lancé avant le premier rendu) ne sont pas perdus.
  generationStoreFor(generator);
  const audio = new Audio();
  audio.preload = 'auto';
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const drive = createDriveSync(lib, clientId ? createDriveClient(clientId) : null);
  // Fonction stable : le lecteur est créé une fois, la connexion Drive peut changer ensuite.
  const player = new PlayerController(audio, lib, (ch) => drive.fetchRemoteAudio(ch));
  bindMediaSession(player);
  return {
    lib,
    generator,
    player,
    importFile,
    getEngine,
    onVoiceDownload: engines.onDownload,
    releaseEngines: (keep) => engines.release(keep),
    sourceFiles: new Map(),
    driveConnected: false,
    drive,
  };
}
