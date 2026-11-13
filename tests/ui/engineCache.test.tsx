import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { EngineCache } from '../../src/ui/engineCache';
import { App } from '../../src/ui/App';
import { makeServices, openTestLibrary } from './helpers';

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
    // L'échec termine l'avancement (1) pour que le bandeau disparaisse.
    expect(seen).toEqual([0.5, 0.5, 0.5, 1, 0.5]);
  });
});

describe('EngineCache — moteur brisé', () => {
  it('un moteur qui n’est plus vivant est remplacé au prochain get', async () => {
    const made: (ReturnType<typeof engine> & { alive: () => boolean })[] = [];
    const cache = new EngineCache(async () => {
      let ok = true;
      const e = { ...engine(), alive: () => ok, kill: () => (ok = false) };
      made.push(e);
      return e;
    });
    const a = await cache.get('siwis');
    (made[0] as unknown as { kill: () => void }).kill();
    const b = await cache.get('siwis');
    expect(b).not.toBe(a);
    expect(made).toHaveLength(2);
    expect(made[0].dispose).toHaveBeenCalled();
  });
});

describe('VoiceDownload', () => {
  it('le bandeau disparaît quand la création du moteur échoue', async () => {
    let reject!: (e: Error) => void;
    const cache = new EngineCache((_v, onDownload) => {
      onDownload(0.4);
      return new Promise((_r, j) => (reject = j));
    });
    const lib = await openTestLibrary();
    window.location.hash = '#/';
    render(<App services={makeServices(lib, { getEngine: cache.get, onVoiceDownload: cache.onDownload })} />);
    let p!: Promise<unknown>;
    act(() => {
      p = cache.get('siwis').catch(() => undefined);
    });
    expect(screen.getByText('Téléchargement de la voix… 40 %')).toBeInTheDocument();
    await act(async () => {
      reject(new Error('réseau'));
      await p;
    });
    expect(screen.queryByText(/Téléchargement de la voix/)).toBeNull();
  });
});
