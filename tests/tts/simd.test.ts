import { describe, expect, it } from 'vitest';
import { isWasmSimdSupported } from '../../src/tts/simd';

describe('isWasmSimdSupported', () => {
  it('vrai quand WebAssembly valide le module SIMD', () => {
    expect(isWasmSimdSupported({ validate: () => true })).toBe(true);
  });
  it('faux quand la validation échoue, lève ou que WebAssembly est absent', () => {
    expect(isWasmSimdSupported({ validate: () => false })).toBe(false);
    expect(isWasmSimdSupported({ validate: () => { throw new Error('x'); } })).toBe(false);
    expect(isWasmSimdSupported(null)).toBe(false);
  });
  it('la sonde est un module valide dans Node (SIMD présent)', () => {
    expect(isWasmSimdSupported()).toBe(true);
  });
});
