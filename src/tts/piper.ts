// Logique pure du pipeline Piper (sans WASM) : chemins des voix, config, tensors, OPFS.
// Portée minimale de @diffusionstudio/vits-web 1.0.3 (dist/vits-web.js).

/** Même dépôt Hugging Face que vits-web (HF_BASE). */
export const HF_BASE = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';

/** Chemins des voix retenues, identiques au PATH_MAP de vits-web 1.0.3. */
export const VOICE_PATHS: Record<string, string> = {
  'fr_FR-siwis-medium': 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
  'fr_FR-upmc-medium': 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx',
  'fr_FR-tom-medium': 'fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx',
};

export type VoiceFile = { url: string; name: string };

/** Fichiers d'une voix : modèle .onnx et config .onnx.json (noms OPFS = dernier segment d'URL, comme vits-web). */
export function voiceFiles(voiceId: string): { model: VoiceFile; config: VoiceFile } {
  const path = VOICE_PATHS[voiceId];
  if (!path) throw new Error(`Voix inconnue : ${voiceId}`);
  const file = (p: string): VoiceFile => ({ url: `${HF_BASE}/${p}`, name: p.split('/').pop() as string });
  return { model: file(path), config: file(`${path}.json`) };
}

export type PiperConfig = {
  sampleRate: number;
  espeakVoice: string;
  noiseScale: number;
  lengthScale: number;
  noiseW: number;
  multiSpeaker: boolean;
};

/** Lit le .onnx.json d'une voix Piper. */
export function parseVoiceConfig(json: unknown): PiperConfig {
  const c = json as {
    audio?: { sample_rate?: unknown };
    espeak?: { voice?: unknown };
    inference?: { noise_scale?: unknown; length_scale?: unknown; noise_w?: unknown };
    speaker_id_map?: Record<string, number> | null;
  };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const cfg: PiperConfig = {
    sampleRate: num(c?.audio?.sample_rate),
    espeakVoice: typeof c?.espeak?.voice === 'string' ? c.espeak.voice : '',
    noiseScale: num(c?.inference?.noise_scale),
    lengthScale: num(c?.inference?.length_scale),
    noiseW: num(c?.inference?.noise_w),
    multiSpeaker: !!c?.speaker_id_map && Object.keys(c.speaker_id_map).length > 0,
  };
  if (!(cfg.sampleRate > 0) || !cfg.espeakVoice || [cfg.noiseScale, cfg.lengthScale, cfg.noiseW].some(Number.isNaN)) {
    throw new Error('Configuration de voix invalide');
  }
  return cfg;
}

/** Arguments de piper_phonemize (callMain), comme vits-web. */
export function phonemizeArgs(text: string, espeakVoice: string): string[] {
  return ['-l', espeakVoice, '--input', JSON.stringify([{ text: text.trim() }]), '--espeak_data', '/espeak-ng-data'];
}

/** Une ligne imprimée par piper_phonemize → identifiants de phonèmes. */
export function parsePhonemeIds(line: string): number[] {
  const ids = (JSON.parse(line) as { phoneme_ids?: unknown }).phoneme_ids;
  if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) throw new Error('Sortie du phonémiseur invalide');
  return ids as number[];
}

export type TensorSpec =
  | { type: 'int64'; data: BigInt64Array; dims: number[] }
  | { type: 'float32'; data: Float32Array; dims: number[] };

/** Entrées du modèle VITS, comme vits-web : input, input_lengths, scales, sid=0 si multi-locuteur. */
export function buildInferenceInputs(phonemeIds: number[], cfg: PiperConfig): Record<string, TensorSpec> {
  const inputs: Record<string, TensorSpec> = {
    input: { type: 'int64', data: BigInt64Array.from(phonemeIds, (x) => BigInt(x)), dims: [1, phonemeIds.length] },
    input_lengths: { type: 'int64', data: BigInt64Array.of(BigInt(phonemeIds.length)), dims: [1] },
    scales: { type: 'float32', data: Float32Array.of(cfg.noiseScale, cfg.lengthScale, cfg.noiseW), dims: [3] },
  };
  if (cfg.multiSpeaker) inputs.sid = { type: 'int64', data: BigInt64Array.of(0n), dims: [1] };
  return inputs;
}

/** Une voix est « stockée » seulement si ses deux fichiers existent et ne sont pas vides. */
export function isVoiceStored(modelSize: number | undefined, configSize: number | undefined): boolean {
  return (modelSize ?? 0) > 0 && (configSize ?? 0) > 0;
}

/** Ratio de téléchargement global de plusieurs fichiers (taille inconnue → ignorée tant qu'inconnue). */
export function downloadRatio(parts: { loaded: number; total: number }[]): number {
  const total = parts.reduce((a, p) => a + (p.total > 0 ? p.total : 0), 0);
  if (total <= 0) return 0;
  const loaded = parts.reduce((a, p) => a + (p.total > 0 ? Math.min(p.loaded, p.total) : 0), 0);
  return Math.min(1, loaded / total);
}
