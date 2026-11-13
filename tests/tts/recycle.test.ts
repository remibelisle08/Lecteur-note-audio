import { describe, expect, it, vi } from 'vitest';
import { recycling } from '../../src/tts/recycle';

describe('recycling', () => {
  it('recrée la ressource après maxUses utilisations', async () => {
    let made = 0;
    const use = recycling(async () => ({ n: ++made }), 3);
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) seen.push(await use(async (r) => r.n));
    expect(seen).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });

  it('après une erreur, réessaie une fois avec une ressource neuve', async () => {
    let made = 0;
    const use = recycling(async () => ({ n: ++made }), 50);
    const fn = vi.fn(async (r: { n: number }) => {
      if (r.n === 1) throw new Error('module brisé');
      return r.n;
    });
    expect(await use(fn)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
    // La ressource neuve est conservée pour la suite.
    expect(await use(async (r) => r.n)).toBe(2);
  });

  it('propage l’erreur si la ressource neuve échoue aussi', async () => {
    const use = recycling(async () => ({}), 50);
    await expect(use(async () => { throw new Error('texte illisible'); })).rejects.toThrow('texte illisible');
  });
});
