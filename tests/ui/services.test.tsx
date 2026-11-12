import { afterEach, describe, expect, it } from 'vitest';
import { createServices } from '../../src/ui/services';
import { generationStoreFor } from '../../src/ui/generationStore';
import type { TtsEngine } from '../../src/tts/engine';
import { chapter, course, note, openTestLibrary } from './helpers';

afterEach(() => {
  delete window.__TEST_TTS__;
});

describe('createServices', () => {
  it('le magasin de génération est abonné avant la reprise : aucun évènement perdu avant le rendu', async () => {
    const engine: TtsEngine = { sampleRate: 22050, synthesize: async () => new Float32Array(2205) };
    window.__TEST_TTS__ = engine;
    const lib = await openTestLibrary();
    await lib.saveCourse(course('c1', 'Bio'));
    await lib.saveNote(note('n1', 'c1', { status: 'generating' }));
    await lib.saveChapter(chapter('a', 'n1', 0));
    await lib.setLocalGeneration('n1', true);
    const services = createServices(lib);
    await services.generator.resumeAll(); // comme main.tsx : avant tout rendu de <App>
    expect(generationStoreFor(services.generator).get('n1').chapters.a).toEqual({ status: 'ready', ratio: 1 });
  });
});
