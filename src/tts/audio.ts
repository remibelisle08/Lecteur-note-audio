import type { Segment } from '../types';
import type { TtsEngine } from './engine';

/** Débit MP3 (kb/s), mono. */
export const MP3_KBPS = 48;
/** Taille d'un bloc envoyé à l'encodeur (une trame MPEG). */
export const MP3_BLOCK = 1152;
export const BEEP_HZ = 880;
export const BEEP_SEC = 0.25;
export const BEEP_AMPLITUDE = 0.3;

/** Sous-ensemble de l'API de lamejs utilisé ici (injectable pour les tests). */
export interface Mp3EncoderLike {
  encodeBuffer(left: Int16Array): Int8Array | Uint8Array;
  flush(): Int8Array | Uint8Array;
}

export type RenderDeps = { createEncoder?: (sampleRate: number) => Mp3EncoderLike };

/** lamejs (~140 ko) est chargé à la demande : engine.ts / listVoices restent légers. */
async function defaultEncoder(sampleRate: number): Promise<Mp3EncoderLike> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  return new Mp3Encoder(1, sampleRate, MP3_KBPS);
}

export function silence(seconds: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.max(0, Math.round(seconds * sampleRate)));
}

/** Bip 880 Hz, 0,25 s, amplitude 0,3, avec rampes de 5 ms contre les clics. */
export function beep(sampleRate: number): Float32Array {
  const n = Math.round(BEEP_SEC * sampleRate);
  const ramp = Math.max(1, Math.round(0.005 * sampleRate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / ramp, (n - 1 - i) / ramp);
    out[i] = BEEP_AMPLITUDE * env * Math.sin((2 * Math.PI * BEEP_HZ * i) / sampleRate);
  }
  return out;
}

/** Lit un WAV PCM 16 bits (mono ; si plusieurs canaux, seul le premier est gardé). */
export function wavToPcm(wav: ArrayBuffer): { pcm: Float32Array; sampleRate: number } {
  const v = new DataView(wav);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (wav.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Fichier WAV invalide');
  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  let bits = 0;
  let format = 0;
  while (offset + 8 <= wav.byteLength) {
    const id = tag(offset);
    const size = v.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
    } else if (id === 'data') {
      if (format !== 1 || bits !== 16 || !sampleRate) throw new Error('WAV non pris en charge (PCM 16 bits attendu)');
      const frames = Math.floor(Math.min(size, wav.byteLength - body) / (2 * channels));
      const pcm = new Float32Array(frames);
      for (let i = 0; i < frames; i++) pcm[i] = v.getInt16(body + i * 2 * channels, true) / 32768;
      return { pcm, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('Fichier WAV invalide (pas de données)');
}

/**
 * Génère le MP3 d'un chapitre en flux : chaque segment est synthétisé (ou généré),
 * converti en Int16 et envoyé à l'encodeur par blocs de 1152 échantillons ; seuls les
 * morceaux MP3 encodés sont conservés, jamais le PCM du chapitre entier.
 */
export async function renderChapterToMp3(
  segments: Segment[],
  engine: TtsEngine,
  onProgress?: (ratio: number) => void,
  deps: RenderDeps = {},
): Promise<{ blob: Blob; durationSec: number }> {
  const sampleRate = engine.sampleRate;
  const encoder = deps.createEncoder ? deps.createEncoder(sampleRate) : await defaultEncoder(sampleRate);
  const chunks: Uint8Array[] = [];
  const block = new Int16Array(MP3_BLOCK);
  let totalSamples = 0;

  const push = (bytes: Int8Array | Uint8Array) => {
    if (bytes.length) chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
  };
  const feed = (pcm: Float32Array) => {
    for (let start = 0; start < pcm.length; start += MP3_BLOCK) {
      const n = Math.min(MP3_BLOCK, pcm.length - start);
      for (let i = 0; i < n; i++) {
        const s = pcm[start + i];
        block[i] = s >= 1 ? 32767 : s <= -1 ? -32768 : Math.round(s < 0 ? s * 32768 : s * 32767);
      }
      push(encoder.encodeBuffer(n === MP3_BLOCK ? block : block.subarray(0, n)));
    }
    totalSamples += pcm.length;
  };
  const feedSilence = (samples: number) => {
    const zeros = new Int16Array(MP3_BLOCK);
    for (let left = samples; left > 0; left -= MP3_BLOCK) {
      const n = Math.min(MP3_BLOCK, left);
      push(encoder.encodeBuffer(n === MP3_BLOCK ? zeros : zeros.subarray(0, n)));
    }
    totalSamples += Math.max(0, samples);
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === 'speech') feed(await engine.synthesize(seg.text));
    else if (seg.kind === 'pause') feedSilence(Math.round(seg.seconds * sampleRate));
    else feed(beep(sampleRate));
    onProgress?.((i + 1) / segments.length);
  }
  push(encoder.flush());
  if (segments.length === 0) onProgress?.(1);

  return {
    blob: new Blob(chunks as BlobPart[], { type: 'audio/mpeg' }),
    durationSec: sampleRate ? totalSamples / sampleRate : 0,
  };
}
