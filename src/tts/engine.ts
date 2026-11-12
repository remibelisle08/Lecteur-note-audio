import { isWasmSimdSupported, SIMD_ERROR } from './simd';

export interface TtsEngine {
  sampleRate: number;
  synthesize(text: string): Promise<Float32Array>;
}

/**
 * Voix françaises retenues (toutes présentes dans le PATH_MAP de vits-web 1.0.3).
 * Liste statique : aucun import du worker ni du WASM, l'UI peut l'importer sans coût.
 * Les métadonnées Piper ne donnent pas le genre des voix : libellés neutres.
 */
const VOICES: { id: string; label: string }[] = [
  { id: 'fr_FR-siwis-medium', label: 'Siwis (par défaut)' },
  { id: 'fr_FR-upmc-medium', label: 'UPMC' },
  { id: 'fr_FR-tom-medium', label: 'Tom' },
];

export function listVoices(): { id: string; label: string }[] {
  return VOICES.map((v) => ({ ...v }));
}

/** Messages échangés avec tts.worker.ts. */
export type WorkerRequest =
  | { type: 'init'; id: number; voiceId: string }
  | { type: 'speak'; id: number; text: string }
  /** Diagnostic : phonèmes seuls, sans modèle de voix. */
  | { type: 'phonemize'; id: number; text: string; espeakVoice: string };
export type WorkerResponse =
  | { type: 'progress'; id: number; ratio: number }
  | { type: 'ready'; id: number; sampleRate: number }
  | { type: 'audio'; id: number; pcm: Float32Array }
  | { type: 'phonemes'; id: number; ids: number[] }
  | { type: 'error'; id: number; message: string };
type RequestBody = WorkerRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never;

export const DOWNLOAD_ERROR = 'Impossible de télécharger la voix. Vérifie ta connexion et réessaie.';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (ratio: number) => void };

/**
 * Lance le moteur Piper dans un Web Worker. Télécharge la voix si besoin (onDownload
 * reçoit le ratio 0–1) ; la fréquence d'échantillonnage est celle du .onnx.json de la voix.
 * Une erreur d'initialisation est rejetée avec DOWNLOAD_ERROR (erreur d'origine en `cause`).
 */
export async function createWorkerEngine(
  voiceId: string,
  onDownload?: (ratio: number) => void,
): Promise<TtsEngine & { dispose(): void }> {
  if (!isWasmSimdSupported()) throw new Error(SIMD_ERROR);
  const worker = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let dead: Error | null = null;

  const failAll = (err: Error) => {
    dead = dead ?? err;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      p.onProgress?.(msg.ratio);
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  };
  worker.onerror = (ev: ErrorEvent) => {
    ev.preventDefault();
    failAll(new Error(`Erreur du moteur vocal : ${ev.message || 'inconnue'}`));
  };
  worker.onmessageerror = () => failAll(new Error('Message illisible reçu du moteur vocal'));

  const request = (body: RequestBody, onProgress?: (ratio: number) => void): Promise<WorkerResponse> => {
    if (dead) return Promise.reject(dead);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ ...body, id } as WorkerRequest);
    });
  };

  const dispose = () => {
    failAll(new Error('Moteur vocal arrêté'));
    worker.terminate();
  };

  let sampleRate: number;
  try {
    const ready = await request({ type: 'init', voiceId }, onDownload);
    if (ready.type !== 'ready') throw new Error('Réponse inattendue du moteur vocal');
    sampleRate = ready.sampleRate;
  } catch (err) {
    dispose();
    throw new Error(DOWNLOAD_ERROR, { cause: err });
  }
  onDownload?.(1);
  return {
    sampleRate,
    async synthesize(text: string) {
      const res = await request({ type: 'speak', text });
      if (res.type !== 'audio') throw new Error('Réponse inattendue du moteur vocal');
      return res.pcm;
    },
    dispose,
  };
}
