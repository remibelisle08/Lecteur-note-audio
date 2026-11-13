import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { makeServices, openTestLibrary, renderAt } from './helpers';
import { SILENT_WAV } from '../../src/player/unlock';

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  plays: string[] = [];
  constructor() {
    FakeAudio.instances.push(this);
  }
  play() {
    this.plays.push(this.src);
    return this.src === SILENT_WAV ? Promise.resolve() : Promise.reject(new Error('NotAllowedError'));
  }
  pause() {}
  addEventListener() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudio.instances = [];
});

describe('SettingsScreen — échantillon de voix', () => {
  it('déverrouille un élément audio dans le clic, puis message précis si la lecture échoue', async () => {
    vi.stubGlobal('Audio', FakeAudio);
    URL.createObjectURL = vi.fn(() => 'blob:sample');
    URL.revokeObjectURL = vi.fn();
    const lib = await openTestLibrary();
    let resolveEngine!: (e: { sampleRate: number; synthesize: () => Promise<Float32Array> }) => void;
    const getEngine = vi.fn(() => new Promise<never>((r) => (resolveEngine = r as never)));
    renderAt('#/settings', makeServices(lib, { getEngine }));

    fireEvent.click(await screen.findByRole('button', { name: 'Écouter un échantillon' }));
    // Synchrone dans le clic, avant la synthèse.
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].plays).toEqual([SILENT_WAV]);

    resolveEngine({ sampleRate: 22050, synthesize: async () => new Float32Array(2205) });
    expect(await screen.findByText('Impossible de lire l’échantillon.', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(FakeAudio.instances[0].plays).toEqual([SILENT_WAV, 'blob:sample']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:sample');
  });
});
