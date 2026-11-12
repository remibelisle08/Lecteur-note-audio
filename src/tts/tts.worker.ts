/// <reference lib="webworker" />
// Worker Piper : phonémiseur (piper-wasm) + UNE session ONNX par voix, WASM servis localement.
// Non testé unitairement (WASM) ; la logique pure est dans piper.ts.
import * as ort from 'onnxruntime-web/wasm';
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm.wasm?url';
import ortWasmSimdUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm?url';
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import phonemizeWasmUrl from '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url';
import phonemizeDataUrl from '@diffusionstudio/piper-wasm/build/piper_phonemize.data?url';
import type { WorkerRequest, WorkerResponse } from './engine';
import {
  buildInferenceInputs,
  downloadRatio,
  isVoiceStored,
  parsePhonemeIds,
  parseVoiceConfig,
  phonemizeArgs,
  voiceFiles,
  type PiperConfig,
  type VoiceFile,
} from './piper';

declare const self: DedicatedWorkerGlobalScope;

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { 'ort-wasm.wasm': ortWasmUrl, 'ort-wasm-simd.wasm': ortWasmSimdUrl };

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

// ---------- Phonémiseur : un seul module, callMain répété (noExitRuntime = true dans ce build) ----------
type Phonemizer = { callMain(args: string[]): number };
let phonemizer: Promise<Phonemizer> | null = null;
let onLine: ((line: string) => void) | null = null;
let onErr: ((line: string) => void) | null = null;

function getPhonemizer(): Promise<Phonemizer> {
  phonemizer ??= createPiperPhonemize({
    print: (line: string) => onLine?.(line),
    printErr: (line: string) => onErr?.(line),
    locateFile: (f: string) => (f.endsWith('.wasm') ? phonemizeWasmUrl : f.endsWith('.data') ? phonemizeDataUrl : f),
  }) as Promise<Phonemizer>;
  return phonemizer;
}

async function phonemize(text: string, espeakVoice: string): Promise<number[]> {
  const mod = await getPhonemizer();
  return new Promise<number[]>((resolve, reject) => {
    let done = false;
    onLine = (line) => {
      if (done) return;
      done = true;
      try { resolve(parsePhonemeIds(line)); } catch (e) { reject(e); }
    };
    onErr = (line) => console.warn('[piper_phonemize]', line);
    try {
      mod.callMain(phonemizeArgs(text, espeakVoice));
    } catch (e) {
      done = true;
      reject(e);
    }
    if (!done) { done = true; reject(new Error('Le phonémiseur n’a rien renvoyé')); }
  }).finally(() => { onLine = null; onErr = null; });
}

// ---------- Stockage OPFS ----------
async function voicesDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await (await navigator.storage.getDirectory()).getDirectoryHandle('piper', { create: true });
  } catch {
    return null; // OPFS indisponible : pas de cache, téléchargement à chaque lancement.
  }
}

async function readStored(dir: FileSystemDirectoryHandle | null, f: VoiceFile): Promise<File | undefined> {
  if (!dir) return undefined;
  try { return await (await dir.getFileHandle(f.name)).getFile(); } catch { return undefined; }
}

async function removeStored(dir: FileSystemDirectoryHandle | null, f: VoiceFile) {
  if (!dir) return;
  try { await dir.removeEntry(f.name); } catch { /* absent */ }
}

/** Écrit puis vérifie la taille ; en cas d'écart ou d'erreur, le fichier est supprimé. */
async function writeStored(dir: FileSystemDirectoryHandle | null, f: VoiceFile, blob: Blob) {
  if (!dir) return;
  try {
    const handle = await dir.getFileHandle(f.name, { create: true });
    if ('createWritable' in handle) {
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      const access = await (handle as FileSystemFileHandle).createSyncAccessHandle();
      try {
        access.truncate(0);
        access.write(new Uint8Array(await blob.arrayBuffer()), { at: 0 });
        access.flush();
      } finally {
        access.close();
      }
    }
    if ((await handle.getFile()).size !== blob.size) throw new Error('taille incorrecte');
  } catch (e) {
    console.warn('[tts] cache OPFS non écrit :', f.name, e);
    await removeStored(dir, f);
  }
}

async function fetchWithProgress(url: string, onBytes: (loaded: number, total: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  const total = Number(res.headers.get('Content-Length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onBytes(loaded, total);
  }
  if (total > 0 && loaded !== total) throw new Error(`Téléchargement incomplet : ${url}`);
  return new Blob(chunks as BlobPart[]);
}

/** Renvoie le modèle et la config, depuis l'OPFS si les deux sont valides, sinon les retélécharge. */
async function loadVoiceFiles(voiceId: string, onRatio: (r: number) => void): Promise<{ model: Blob; config: Blob }> {
  const files = voiceFiles(voiceId);
  const dir = await voicesDir();
  const [m, c] = await Promise.all([readStored(dir, files.model), readStored(dir, files.config)]);
  if (m && c && isVoiceStored(m.size, c.size)) return { model: m, config: c };
  await Promise.all([removeStored(dir, files.model), removeStored(dir, files.config)]);
  const parts = [{ loaded: 0, total: 0 }, { loaded: 0, total: 0 }];
  const track = (i: number) => (loaded: number, total: number) => {
    parts[i] = { loaded, total };
    onRatio(downloadRatio(parts));
  };
  const [model, config] = await Promise.all([
    fetchWithProgress(files.model.url, track(0)),
    fetchWithProgress(files.config.url, track(1)),
  ]);
  if (!isVoiceStored(model.size, config.size)) throw new Error('Fichiers de voix vides');
  await writeStored(dir, files.config, config);
  await writeStored(dir, files.model, model);
  return { model, config };
}

// ---------- Session ONNX (une par voix, libérée au changement de voix) ----------
let session: ort.InferenceSession | null = null;
let config: PiperConfig | null = null;

async function init(voiceId: string, onRatio: (r: number) => void): Promise<PiperConfig> {
  const files = await loadVoiceFiles(voiceId, onRatio);
  const cfg = parseVoiceConfig(JSON.parse(await files.config.text()));
  if (session) {
    await session.release();
    session = null;
    config = null;
  }
  const [s] = await Promise.all([
    ort.InferenceSession.create(new Uint8Array(await files.model.arrayBuffer())),
    getPhonemizer(),
  ]);
  session = s;
  config = cfg;
  return cfg;
}

async function speak(text: string): Promise<Float32Array> {
  if (!session || !config) throw new Error('Moteur vocal non initialisé');
  const ids = await phonemize(text, config.espeakVoice);
  const feeds: Record<string, ort.Tensor> = {};
  for (const [name, t] of Object.entries(buildInferenceInputs(ids, config))) {
    feeds[name] = new ort.Tensor(t.type, t.data, t.dims);
  }
  const results = await session.run(feeds);
  try {
    return Float32Array.from(results.output.data as Float32Array);
  } finally {
    for (const t of Object.values(results)) t.dispose();
  }
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      const cfg = await init(msg.voiceId, (ratio) => post({ type: 'progress', id: msg.id, ratio }));
      post({ type: 'ready', id: msg.id, sampleRate: cfg.sampleRate });
    } else if (msg.type === 'speak') {
      const pcm = await speak(msg.text);
      post({ type: 'audio', id: msg.id, pcm }, [pcm.buffer]);
    } else if (msg.type === 'phonemize') {
      // Diagnostic : phonèmes seuls (vérifie le phonémiseur sans modèle de voix).
      const ids = await phonemize(msg.text, msg.espeakVoice);
      post({ type: 'phonemes', id: msg.id, ids });
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
