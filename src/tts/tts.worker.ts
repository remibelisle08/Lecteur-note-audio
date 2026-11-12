/// <reference lib="webworker" />
// Worker mince autour de vits-web (Piper, ONNX/WASM). Non testé unitairement.
import * as tts from '@diffusionstudio/vits-web';
import type { WorkerRequest, WorkerResponse } from './engine';

declare const self: DedicatedWorkerGlobalScope;

let voiceId: tts.VoiceId | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      const id = msg.voiceId as tts.VoiceId;
      if (!(id in tts.PATH_MAP)) throw new Error(`Voix inconnue : ${msg.voiceId}`);
      // download() retélécharge toujours : on l'évite si la voix est déjà dans l'OPFS.
      if (!(await tts.stored()).includes(id)) {
        await tts.download(id, (p) => {
          if (p.total > 0) post({ type: 'progress', id: msg.id, ratio: Math.min(1, p.loaded / p.total) });
        });
      }
      voiceId = id;
      post({ type: 'ready', id: msg.id });
    } else if (msg.type === 'speak') {
      if (!voiceId) throw new Error('Moteur vocal non initialisé');
      const blob = await tts.predict({ text: msg.text, voiceId });
      const wav = await blob.arrayBuffer();
      post({ type: 'audio', id: msg.id, wav }, [wav]);
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
