/** Module WebAssembly minimal qui utilise des instructions SIMD (i8x16.splat, i8x16.popcnt) : valide seulement si le SIMD est géré. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export const SIMD_ERROR = 'Ton navigateur est trop ancien pour générer la voix. Mets à jour iOS/ton navigateur.';

/** Vrai si le navigateur gère WebAssembly SIMD (requis par la variante ONNX embarquée). */
export function isWasmSimdSupported(wasm: { validate(bytes: BufferSource): boolean } | null = globalThis.WebAssembly ?? null): boolean {
  try {
    return !!wasm && wasm.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}
