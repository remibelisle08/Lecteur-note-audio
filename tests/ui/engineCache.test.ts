import { describe, expect, it, vi } from 'vitest';
import { EngineCache } from '../../src/ui/engineCache';

const engine = () => ({ sampleRate: 22050, synthesize: vi.fn(async () => new Float32Array(1)), dispose: vi.fn() });

describe('EngineCache', () => {
  it('un moteur par voix, libéré quand la voix change ; un échec n’est pas mémorisé', async () => {
    const made: ReturnType<typeof engine>[] = [];
    let fail = false;
    const cache = new EngineCache(async (_voice, onDownload) => {
      onDownload(0.5);
      if (fail) throw new Error('réseau');
      const e = engine();
      made.push(e);
      return e;
    });
    const seen: number[] = [];
    cache.onDownload((r) => seen.push(r));

    const a = await cache.get('siwis');
    expect(await cache.get('siwis')).toBe(a);
    expect(made).toHaveLength(1);

    await cache.get('tom');
    await Promise.resolve();
    expect(made[0].dispose).toHaveBeenCalled();
    expect(made).toHaveLength(2);

    fail = true;
    await expect(cache.get('upmc')).rejects.toThrow('réseau');
    fail = false;
    await cache.get('upmc');
    expect(made).toHaveLength(3);
    expect(seen).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});
