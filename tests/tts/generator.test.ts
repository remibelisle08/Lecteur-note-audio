import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { openLibrary, type Library } from '../../src/library/db';
import { Generator } from '../../src/tts/generator';
import type { TtsEngine } from '../../src/tts/engine';
import type { Chapter, Note } from '../../src/types';

let n = 0;
const fakeEncoder = () => ({ encodeBuffer: () => new Uint8Array(2), flush: () => new Uint8Array(1) });

function makeEngine(opts: { failOn?: string; gate?: Promise<void> } = {}) {
  const calls: string[] = [];
  const engine: TtsEngine = {
    sampleRate: 22050,
    async synthesize(text) {
      calls.push(text);
      if (opts.gate) await opts.gate;
      if (opts.failOn && text.includes(opts.failOn)) throw new Error('boom');
      return new Float32Array(2205);
    },
  };
  return { engine, calls };
}

async function setup(titles: { title: string; text: string; included?: boolean; status?: Chapter['audioStatus'] }[], noteId = 'n1') {
  const lib = await openLibrary(`gen-${++n}`);
  await lib.saveCourse({ id: 'c1', name: 'Cours', order: 0, updatedAt: 0 });
  await addNote(lib, noteId, titles);
  return lib;
}
async function addNote(lib: Library, noteId: string, titles: { title: string; text: string; included?: boolean; status?: Chapter['audioStatus'] }[], createdAt = 1) {
  const note: Note = {
    id: noteId, courseId: 'c1', title: noteId, sourceFileName: 'f.pdf', order: 0, createdAt, updatedAt: 0,
    status: 'draft', quizMode: false, usedOcr: false,
  };
  await lib.saveNote(note);
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    await lib.saveChapter({
      id: `${noteId}-c${i}`, noteId, index: i, title: t.title, text: t.text, included: t.included ?? true,
      audioStatus: t.status ?? 'pending', audioLocal: false, updatedAt: 0,
    });
  }
}
const gen = (lib: Library, engine: TtsEngine) => new Generator(lib, async () => engine, { createEncoder: fakeEncoder });

describe('Generator', () => {
  it('génère les chapitres dans l’ordre et passe la note à ready', async () => {
    const lib = await setup([{ title: 'Un', text: 'Alpha.' }, { title: 'Deux', text: 'Beta.' }]);
    const { engine, calls } = makeEngine();
    const g = gen(lib, engine);
    const events: string[] = [];
    g.onProgress((e) => events.push(`${e.chapterId}:${e.status}`));
    await g.generateNote('n1');
    const chs = await lib.listChapters('n1');
    expect(chs.map((c) => c.audioStatus)).toEqual(['ready', 'ready']);
    expect(chs.every((c) => c.audioLocal && (c.durationSec ?? 0) > 0)).toBe(true);
    expect(calls.findIndex((c) => c.includes('Alpha'))).toBeLessThan(calls.findIndex((c) => c.includes('Beta')));
    expect((await lib.getNote('n1'))!.status).toBe('ready');
    expect(events).toContain('n1-c1:ready');
    expect(g.busy).toBe(false);
  });

  it('supprime les chapitres exclus et réindexe', async () => {
    const lib = await setup([
      { title: 'A', text: 'a.' }, { title: 'B', text: 'b.', included: false }, { title: 'C', text: 'c.' },
    ]);
    await gen(lib, makeEngine().engine).generateNote('n1');
    const chs = await lib.listChapters('n1');
    expect(chs.map((c) => [c.title, c.index])).toEqual([['A', 0], ['C', 1]]);
  });

  it('chapitre en échec : error, le suivant est généré, la note reste generating', async () => {
    const lib = await setup([{ title: 'A', text: 'a.' }, { title: 'B', text: 'explosion.' }, { title: 'C', text: 'c.' }]);
    const g = gen(lib, makeEngine({ failOn: 'explosion' }).engine);
    const events: { status: string; message?: string }[] = [];
    g.onProgress((e) => events.push(e as never));
    await g.generateNote('n1');
    expect((await lib.listChapters('n1')).map((c) => c.audioStatus)).toEqual(['ready', 'error', 'ready']);
    expect((await lib.getNote('n1'))!.status).toBe('generating');
    expect(events.some((e) => e.status === 'error' && e.message)).toBe(true);
  });

  it('QuotaExceededError : arrêt, message, chapitres suivants intacts', async () => {
    const lib = await setup([{ title: 'A', text: 'a.' }, { title: 'B', text: 'b.' }]);
    const quota = Object.assign(Object.create(lib), lib, {
      putAudio: async () => { throw new DOMException('full', 'QuotaExceededError'); },
    }) as Library;
    const g = new Generator(quota, async () => makeEngine().engine, { createEncoder: fakeEncoder });
    const events: { status: string; message?: string }[] = [];
    g.onProgress((e) => events.push(e as never));
    await g.generateNote('n1');
    expect((await lib.listChapters('n1')).map((c) => c.audioStatus)).toEqual(['error', 'pending']);
    expect((await lib.getNote('n1'))!.status).toBe('generating');
    expect(events.find((e) => e.status === 'error')!.message).toBe('Espace insuffisant sur l’appareil');
  });

  it('getEngine échoue : événement d’erreur, chapitres pending, ne rejette pas', async () => {
    const lib = await setup([{ title: 'A', text: 'a.' }]);
    const g = new Generator(lib, async () => { throw new Error('Voix indisponible'); }, { createEncoder: fakeEncoder });
    const events: { status: string; message?: string; chapterId: string }[] = [];
    g.onProgress((e) => events.push(e as never));
    await expect(g.generateNote('n1')).resolves.toBeUndefined();
    expect(events[0]).toMatchObject({ status: 'error', message: 'Voix indisponible', chapterId: 'n1-c0' });
    expect((await lib.listChapters('n1'))[0].audioStatus).toBe('pending');
    expect((await lib.getNote('n1'))!.status).toBe('generating');
  });

  it('deux appels concurrents sont sérialisés ; même note = même promesse', async () => {
    const lib = await setup([{ title: 'A', text: 'a.' }]);
    await addNote(lib, 'n2', [{ title: 'B', text: 'b.' }]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { engine } = makeEngine({ gate });
    const g = gen(lib, engine);
    const p1 = g.generateNote('n1');
    const p2 = g.generateNote('n2');
    expect(g.generateNote('n1')).toBe(p1);
    expect(g.busy).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect((await lib.getNote('n2'))!.status).toBe('draft');
    release();
    await Promise.all([p1, p2]);
    expect((await lib.getNote('n2'))!.status).toBe('ready');
    expect(g.busy).toBe(false);
  });

  it('resumeAll reprend au premier non prêt sans régénérer les prêts', async () => {
    const lib = await setup([
      { title: 'A', text: 'Alpha.', status: 'ready' }, { title: 'B', text: 'Beta.', status: 'generating' }, { title: 'C', text: 'Gamma.' },
    ]);
    const note = (await lib.getNote('n1'))!;
    await lib.saveNote({ ...note, status: 'generating' });
    const { engine, calls } = makeEngine();
    await gen(lib, engine).resumeAll();
    expect(calls.some((c) => c.includes('Alpha'))).toBe(false);
    expect(calls.some((c) => c.includes('Beta'))).toBe(true);
    expect(calls.some((c) => c.includes('Gamma'))).toBe(true);
    expect((await lib.listChapters('n1')).map((c) => c.audioStatus)).toEqual(['ready', 'ready', 'ready']);
    expect((await lib.getNote('n1'))!.status).toBe('ready');
  });

  it('progression pendant le rendu', async () => {
    const lib = await setup([{ title: 'A', text: 'a.' }]);
    const g = gen(lib, makeEngine().engine);
    const fn = vi.fn();
    const off = g.onProgress(fn);
    await g.generateNote('n1');
    off();
    expect(fn.mock.calls.some(([e]) => e.status === 'generating')).toBe(true);
    expect(fn.mock.calls.at(-1)![0]).toMatchObject({ status: 'ready', ratio: 1 });
  });
});
