import { describe, it, expect } from 'vitest';
import { HF_BASE as VITS_HF_BASE, PATH_MAP } from '@diffusionstudio/vits-web';
import {
  HF_BASE, VOICE_PATHS, buildInferenceInputs, downloadRatio, isVoiceStored,
  parsePhonemeIds, parseVoiceConfig, phonemizeArgs, voiceFiles,
} from '../../src/tts/piper';
import { listVoices } from '../../src/tts/engine';

const CONFIG = {
  audio: { sample_rate: 22050 },
  espeak: { voice: 'fr' },
  inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
  speaker_id_map: {},
};

describe('voix', () => {
  it('chemins identiques à vits-web 1.0.3, et toutes les voix de listVoices y figurent', () => {
    expect(HF_BASE).toBe(VITS_HF_BASE);
    for (const [id, path] of Object.entries(VOICE_PATHS)) expect(PATH_MAP[id as keyof typeof PATH_MAP]).toBe(path);
    for (const v of listVoices()) expect(VOICE_PATHS[v.id]).toBeDefined();
  });
  it('voiceFiles : URL Hugging Face du .onnx et du .onnx.json', () => {
    const f = voiceFiles('fr_FR-siwis-medium');
    expect(f.model.url).toBe(`${HF_BASE}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx`);
    expect(f.config.url).toBe(`${HF_BASE}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json`);
    expect(f.model.name).toBe('fr_FR-siwis-medium.onnx');
    expect(f.config.name).toBe('fr_FR-siwis-medium.onnx.json');
    expect(() => voiceFiles('xx')).toThrow(/Voix inconnue/);
  });
});

describe('parseVoiceConfig', () => {
  it('lit fréquence, voix espeak, paramètres d’inférence', () => {
    expect(parseVoiceConfig(CONFIG)).toEqual({
      sampleRate: 22050, espeakVoice: 'fr', noiseScale: 0.667, lengthScale: 1, noiseW: 0.8, multiSpeaker: false,
    });
    expect(parseVoiceConfig({ ...CONFIG, speaker_id_map: { jessica: 0, pierre: 1 } }).multiSpeaker).toBe(true);
    expect(parseVoiceConfig({ ...CONFIG, speaker_id_map: undefined }).multiSpeaker).toBe(false);
  });
  it('refuse une config incomplète', () => {
    expect(() => parseVoiceConfig({ ...CONFIG, audio: {} })).toThrow();
    expect(() => parseVoiceConfig({ ...CONFIG, espeak: {} })).toThrow();
    expect(() => parseVoiceConfig({ ...CONFIG, inference: { noise_scale: 1 } })).toThrow();
    expect(() => parseVoiceConfig(null)).toThrow();
  });
});

describe('phonémiseur', () => {
  it('phonemizeArgs : mêmes arguments que vits-web, texte rogné', () => {
    expect(phonemizeArgs('  Bonjour.  ', 'fr')).toEqual([
      '-l', 'fr', '--input', '[{"text":"Bonjour."}]', '--espeak_data', '/espeak-ng-data',
    ]);
  });
  it('parsePhonemeIds : lit phoneme_ids, refuse le reste', () => {
    expect(parsePhonemeIds('{"phoneme_ids":[1,0,25,0,2]}')).toEqual([1, 0, 25, 0, 2]);
    expect(() => parsePhonemeIds('{"phoneme_ids":["a"]}')).toThrow();
    expect(() => parsePhonemeIds('{}')).toThrow();
    expect(() => parsePhonemeIds('pas du json')).toThrow();
  });
});

describe('buildInferenceInputs', () => {
  it('input, input_lengths, scales [noise_scale, length_scale, noise_w], sans sid pour une voix mono-locuteur', () => {
    const t = buildInferenceInputs([1, 0, 25, 2], parseVoiceConfig(CONFIG));
    expect(Object.keys(t).sort()).toEqual(['input', 'input_lengths', 'scales']);
    expect(t.input.type).toBe('int64');
    expect(t.input.dims).toEqual([1, 4]);
    expect(Array.from(t.input.data as BigInt64Array)).toEqual([1n, 0n, 25n, 2n]);
    expect(t.input_lengths.dims).toEqual([1]);
    expect(Array.from(t.input_lengths.data as BigInt64Array)).toEqual([4n]);
    expect(t.scales.type).toBe('float32');
    expect(t.scales.dims).toEqual([3]);
    const s = Array.from(t.scales.data as Float32Array);
    expect(s[0]).toBeCloseTo(0.667, 5);
    expect(s[1]).toBe(1);
    expect(s[2]).toBeCloseTo(0.8, 5);
  });
  it('sid = 0 uniquement si speaker_id_map est non vide', () => {
    const t = buildInferenceInputs([1, 2], parseVoiceConfig({ ...CONFIG, speaker_id_map: { a: 0, b: 1 } }));
    expect(t.sid.type).toBe('int64');
    expect(t.sid.dims).toEqual([1]);
    expect(Array.from(t.sid.data as BigInt64Array)).toEqual([0n]);
  });
});

describe('stockage et téléchargement', () => {
  it('isVoiceStored : les deux fichiers présents et non vides', () => {
    expect(isVoiceStored(60_000_000, 5_000)).toBe(true);
    expect(isVoiceStored(0, 5_000)).toBe(false);
    expect(isVoiceStored(60_000_000, 0)).toBe(false);
    expect(isVoiceStored(undefined, 5_000)).toBe(false);
    expect(isVoiceStored(60_000_000, undefined)).toBe(false);
  });
  it('downloadRatio : agrège les fichiers, ignore les tailles inconnues, plafonné à 1', () => {
    expect(downloadRatio([{ loaded: 0, total: 0 }, { loaded: 0, total: 0 }])).toBe(0);
    expect(downloadRatio([{ loaded: 50, total: 100 }, { loaded: 0, total: 0 }])).toBe(0.5);
    expect(downloadRatio([{ loaded: 90, total: 100 }, { loaded: 10, total: 100 }])).toBe(0.5);
    expect(downloadRatio([{ loaded: 200, total: 100 }])).toBe(1);
  });
});
