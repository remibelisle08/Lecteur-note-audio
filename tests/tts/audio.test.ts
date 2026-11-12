import { describe, it, expect } from 'vitest';
import { Mp3Encoder } from '@breezystack/lamejs';
import { PATH_MAP } from '@diffusionstudio/vits-web';
import { beep, renderChapterToMp3, silence, wavToPcm, type Mp3EncoderLike } from '../../src/tts/audio';
import { listVoices, type TtsEngine } from '../../src/tts/engine';
import type { Segment } from '../../src/types';

const SR = 22050;

/** Moteur factice : 1 s de sinus 440 Hz par phrase. */
function fakeEngine(): TtsEngine & { calls: string[] } {
  const calls: string[] = [];
  return {
    sampleRate: SR,
    calls,
    async synthesize(text: string) {
      calls.push(text);
      const out = new Float32Array(SR);
      for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR);
      return out;
    },
  };
}

function makeWav(samples: number[], sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, buf.byteLength - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return buf;
}

async function blobBytes(b: Blob): Promise<Uint8Array> {
  // jsdom : Blob sans arrayBuffer() → FileReader.
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
  return new Uint8Array(buf);
}

const SEGMENTS: Segment[] = [
  { kind: 'speech', text: 'Bonjour.' },
  { kind: 'pause', seconds: 2 },
  { kind: 'beep' },
  { kind: 'speech', text: 'Au revoir.' },
];

describe('silence / beep', () => {
  it('silence : longueur exacte', () => expect(silence(8, 22050).length).toBe(176400));
  it('silence : que des zéros', () => expect(silence(0.5, SR).every((x) => x === 0)).toBe(true));
  it('beep : 0,25 s, amplitude max ≤ 0,3', () => {
    const b = beep(SR);
    expect(b.length).toBe(Math.round(0.25 * SR));
    let max = 0;
    for (const x of b) max = Math.max(max, Math.abs(x));
    expect(max).toBeLessThanOrEqual(0.3);
    expect(max).toBeGreaterThan(0.25);
  });
});

describe('wavToPcm', () => {
  it('wavToPcm lit un WAV PCM 16 bits mono', () => {
    const { pcm, sampleRate } = wavToPcm(makeWav([0, 16384, -16384, 32767, -32768], 22050));
    expect(sampleRate).toBe(22050);
    expect(pcm.length).toBe(5);
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBeCloseTo(0.5, 4);
    expect(pcm[2]).toBeCloseTo(-0.5, 4);
    expect(pcm[3]).toBeCloseTo(1, 3);
    expect(pcm[4]).toBe(-1);
  });
  it('wavToPcm refuse un fichier qui n’est pas un WAV', () => {
    expect(() => wavToPcm(new ArrayBuffer(10))).toThrow();
  });
});

describe('renderChapterToMp3', () => {
  it('renderChapterToMp3 produit un MP3 (en-tête ID3 ou synchro 0xFFE) et la bonne durée', async () => {
    const engine = fakeEngine();
    const { blob, durationSec } = await renderChapterToMp3(SEGMENTS, engine);
    expect(blob.type).toBe('audio/mpeg');
    const bytes = await blobBytes(blob);
    expect(bytes.length).toBeGreaterThan(1000);
    const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    const sync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    expect(id3 || sync).toBe(true);
    expect(durationSec).toBeGreaterThan(4.15);
    expect(durationSec).toBeLessThan(4.35);
    expect(engine.calls).toEqual(['Bonjour.', 'Au revoir.']);
  });

  it('renderChapterToMp3 encode en flux : l’encodeur reçoit chaque segment séparément, jamais le chapitre entier', async () => {
    const sizes: number[] = [];
    const createEncoder = (sampleRate: number): Mp3EncoderLike => {
      const real = new Mp3Encoder(1, sampleRate, 48);
      return {
        encodeBuffer(left: Int16Array) { sizes.push(left.length); return real.encodeBuffer(left); },
        flush: () => real.flush(),
      };
    };
    await renderChapterToMp3(SEGMENTS, fakeEngine(), undefined, { createEncoder });
    const longestSegment = Math.max(SR, 2 * SR, Math.round(0.25 * SR));
    expect(sizes.length).toBeGreaterThanOrEqual(SEGMENTS.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(longestSegment);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1152);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(SR + 2 * SR + Math.round(0.25 * SR) + SR);
  });

  it('renderChapterToMp3 rapporte la progression jusqu’à 1', async () => {
    const ratios: number[] = [];
    await renderChapterToMp3(SEGMENTS, fakeEngine(), (r) => ratios.push(r));
    expect(ratios.length).toBeGreaterThan(0);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThanOrEqual(ratios[i - 1]);
    expect(ratios.every((r) => r >= 0 && r <= 1)).toBe(true);
    expect(ratios[ratios.length - 1]).toBe(1);
  });

  it('chapitre vide : MP3 valide de durée 0 et progression à 1', async () => {
    const ratios: number[] = [];
    const { blob, durationSec } = await renderChapterToMp3([], fakeEngine(), (r) => ratios.push(r));
    expect(blob.type).toBe('audio/mpeg');
    expect(durationSec).toBe(0);
    expect(ratios[ratios.length - 1]).toBe(1);
  });
});

describe('listVoices', () => {
  it('voix FR retenues, présentes dans vits-web, siwis en premier', () => {
    const voices = listVoices();
    expect(voices.map((v) => v.id)).toEqual(['fr_FR-siwis-medium', 'fr_FR-upmc-medium', 'fr_FR-tom-medium']);
    for (const v of voices) {
      expect(v.id in PATH_MAP).toBe(true);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });
});
