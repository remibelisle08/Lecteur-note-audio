import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openLibrary, type Library } from '../../src/library/db';
import { PlayerController, type PlayerState } from '../../src/player/controller';
import { bindMediaSession } from '../../src/player/mediaSession';
import type { Chapter, Course, Note } from '../../src/types';

class FakeAudio extends EventTarget {
  currentTime = 0;
  duration = NaN;
  playbackRate = 1;
  preservesPitch = false;
  paused = true;
  durationFor = 100;
  private _src = '';
  get src() {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this.currentTime = 0;
    this.duration = NaN;
    if (v) {
      queueMicrotask(() => {
        this.duration = this.durationFor;
        this.dispatchEvent(new Event('loadedmetadata'));
      });
    }
  }
  playError?: { name: string };
  play = vi.fn(async () => {
    if (this.playError) throw Object.assign(new Error('refus'), this.playError);
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  });
  pause = vi.fn(() => {
    if (this.paused) return;
    this.paused = true;
    queueMicrotask(() => this.dispatchEvent(new Event('pause')));
  });
  removeAttribute = vi.fn(() => {
    this._src = '';
  });
  load = vi.fn();
}

let n = 0;
let lib: Library;
let audio: FakeAudio;
let created: string[];
let revoked: string[];
const flush = async (rounds = 30) => {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
};

const course = (id: string, order = 0): Course => ({ id, name: 'Cours ' + id, order, updatedAt: 0 });
const note = (id: string, courseId = 'c1', order = 0): Note => ({
  id, courseId, title: 'Note ' + id, sourceFileName: id + '.pdf', order, createdAt: 1, updatedAt: 0,
  status: 'ready', quizMode: false, usedOcr: false,
});
const chapter = (id: string, noteId: string, index: number, over: Partial<Chapter> = {}): Chapter => ({
  id, noteId, index, title: 'Ch ' + id, text: 'texte', included: true,
  audioStatus: 'ready', audioLocal: false, updatedAt: 0, ...over,
});
const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });

async function seedNote(id: string, count: number, courseId = 'c1', order = 0) {
  await lib.saveNote(note(id, courseId, order));
  for (let i = 0; i < count; i++) {
    await lib.saveChapter(chapter(`${id}-${i}`, id, i));
    await lib.putAudio(`${id}-${i}`, blob());
  }
}

function mk(fetchRemote?: (ch: Chapter) => Promise<Blob | undefined>) {
  return new PlayerController(audio as unknown as HTMLAudioElement, lib, fetchRemote);
}
function last(ctrl: PlayerController): PlayerState {
  let s!: PlayerState;
  ctrl.subscribe((x) => (s = x))();
  return s;
}

beforeEach(async () => {
  lib = await openLibrary('test-player-' + n++);
  await lib.saveCourse(course('c1'));
  audio = new FakeAudio();
  created = [];
  revoked = [];
  let k = 0;
  URL.createObjectURL = vi.fn(() => {
    const u = 'blob:fake-' + k++;
    created.push(u);
    return u;
  });
  URL.revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
});

describe('PlayerController', () => {
  it('subscribe appelle immédiatement avec l’état courant', async () => {
    const ctrl = mk();
    const l = vi.fn();
    ctrl.subscribe(l);
    expect(l).toHaveBeenCalledTimes(1);
    expect(l.mock.calls[0][0]).toMatchObject({ queue: [], index: 0, playing: false, waitingForAudio: false });
    ctrl.dispose();
  });

  it('loadNote reprend au chapitre et à la position sauvegardés', async () => {
    await seedNote('n1', 3);
    await lib.saveProgress({ noteId: 'n1', chapterIndex: 1, positionSec: 42, completedChapterIds: ['n1-0'], updatedAt: 0 });
    const ctrl = mk();
    await ctrl.loadNote('n1');
    await flush();
    const s = last(ctrl);
    expect(s.queue.map((q) => q.chapterId)).toEqual(['n1-0', 'n1-1', 'n1-2']);
    expect(s.index).toBe(1);
    expect(s.item).toMatchObject({ noteTitle: 'Note n1', courseName: 'Cours c1', title: 'Ch n1-1' });
    expect(audio.currentTime).toBe(42);
    expect(audio.preservesPitch).toBe(true);
    ctrl.dispose();
  });

  it('next() pendant la lecture reprend sur le nouveau chapitre (évènement pause asynchrone)', async () => {
    await seedNote('n1', 2);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    await ctrl.play();
    await ctrl.next();
    await flush();
    expect(last(ctrl).index).toBe(1);
    expect(last(ctrl).playing).toBe(true);
    expect(audio.paused).toBe(false);
    ctrl.dispose();
  });

  it('play() refusé (NotAllowedError) : état non menteur, pas de reprise auto', async () => {
    await seedNote('n1', 2);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    audio.playError = { name: 'NotAllowedError' };
    await ctrl.play();
    expect(last(ctrl).playing).toBe(false);
    audio.playError = undefined;
    await ctrl.next();
    await flush();
    expect(last(ctrl).playing).toBe(false);
    ctrl.dispose();
  });

  it('loadNote ne lance jamais la lecture automatiquement', async () => {
    await seedNote('n1', 1);
    await seedNote('n2', 1);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    await ctrl.play();
    await ctrl.loadNote('n2');
    await flush();
    expect(last(ctrl).playing).toBe(false);
    await ctrl.loadCourse('c1');
    await flush();
    expect(last(ctrl).playing).toBe(false);
    ctrl.dispose();
  });

  it('échec de fetchRemoteAudio : error exposée, pas de rejet non géré', async () => {
    await seedNote('n1', 1);
    await lib.saveNote(note('n2'));
    await lib.saveChapter(chapter('n2-0', 'n2', 0, { audioDriveId: 'drv' }));
    await lib.saveChapter(chapter('n1-1', 'n1', 1, { audioDriveId: 'drv' }));
    const ctrl = mk(async () => {
      throw new Error('hors ligne');
    });
    await ctrl.loadNote('n1');
    await ctrl.play();
    audio.dispatchEvent(new Event('ended'));
    await flush();
    const s = last(ctrl);
    expect(s.index).toBe(1);
    expect(s.playing).toBe(false);
    expect(s.waitingForAudio).toBe(false);
    expect(s.error).toBe('Impossible de charger ce chapitre. Vérifie ta connexion.');
    ctrl.dispose();
  });

  it('après une erreur de chargement : source vidée, play() retente le chargement', async () => {
    await seedNote('n1', 1);
    await lib.saveChapter(chapter('n1-1', 'n1', 1, { audioDriveId: 'drv' }));
    let fail = true;
    const ctrl = mk(async () => {
      if (fail) throw new Error('hors ligne');
      return blob();
    });
    await ctrl.loadNote('n1');
    await ctrl.play();
    audio.currentTime = 40;
    await ctrl.next();
    await flush();
    expect(last(ctrl).error).toBeDefined();
    expect(audio.src).toBe('');
    expect(created.length).toBe(revoked.length);
    const pr = await lib.getProgress('n1');
    expect(pr?.chapterIndex === 1 && pr.positionSec === 40).toBe(false);
    fail = false;
    await ctrl.play();
    await flush();
    const s = last(ctrl);
    expect(s.error).toBeUndefined();
    expect(s.index).toBe(1);
    expect(s.playing).toBe(true);
    expect(audio.src).not.toBe('');
    ctrl.dispose();
  });

  it('un abonné qui lève une exception n’est pas pris pour une erreur de chargement', async () => {
    await seedNote('n1', 1);
    const ctrl = mk();
    let calls = 0;
    ctrl.subscribe(() => {
      if (calls++ > 0) throw new Error('boum');
    });
    await ctrl.loadNote('n1');
    await flush();
    expect(last(ctrl).error).toBeUndefined();
    expect(audio.src).not.toBe('');
    ctrl.dispose();
  });

  it('utilise removeAttribute(src) + load() quand le chapitre n’est pas prêt', async () => {
    await lib.saveNote(note('n1'));
    await lib.saveChapter(chapter('n1-0', 'n1', 0, { audioStatus: 'pending' }));
    const ctrl = mk();
    await ctrl.loadNote('n1');
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(audio.load).toHaveBeenCalled();
    ctrl.dispose();
  });

  it('ignore les chapitres exclus et utilise defaultRate', async () => {
    await seedNote('n1', 3);
    await lib.saveChapter(chapter('n1-1', 'n1', 1, { included: false }));
    await lib.saveSettings({ ...(await lib.getSettings()), defaultRate: 1.5 });
    const ctrl = mk();
    await ctrl.loadNote('n1');
    expect(last(ctrl).queue.map((q) => q.chapterId)).toEqual(['n1-0', 'n1-2']);
    expect(audio.playbackRate).toBe(1.5);
    ctrl.dispose();
  });

  it('seekBy(±15) borné à [0, duration]', async () => {
    await seedNote('n1', 1);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    await flush();
    audio.currentTime = 90;
    ctrl.seekBy(15);
    expect(audio.currentTime).toBe(100);
    audio.currentTime = 5;
    ctrl.seekBy(-15);
    expect(audio.currentTime).toBe(0);
    audio.currentTime = 50;
    ctrl.seekBy(15);
    expect(audio.currentTime).toBe(65);
    ctrl.dispose();
  });

  it('ended enchaîne, puis s’arrête sur le dernier chapitre', async () => {
    await seedNote('n1', 2);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    await ctrl.play();
    audio.dispatchEvent(new Event('ended'));
    await flush();
    expect(last(ctrl).index).toBe(1);
    expect(last(ctrl).playing).toBe(true);
    audio.dispatchEvent(new Event('ended'));
    await flush();
    expect(last(ctrl).index).toBe(1);
    expect(last(ctrl).playing).toBe(false);
    ctrl.dispose();
  });

  it('setRate arrondit au 0,25 et borne à [0.75, 2]', async () => {
    await seedNote('n1', 1);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    ctrl.setRate(2.3);
    expect(last(ctrl).rate).toBe(2);
    ctrl.setRate(1.1);
    expect(last(ctrl).rate).toBe(1);
    ctrl.setRate(0.2);
    expect(audio.playbackRate).toBe(0.75);
    ctrl.setRate(9);
    expect(audio.playbackRate).toBe(2);
    ctrl.dispose();
  });

  it('conserve la vitesse après changement de chapitre', async () => {
    await seedNote('n1', 2);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    ctrl.setRate(1.75);
    audio.playbackRate = 1;
    audio.preservesPitch = false;
    await ctrl.next();
    expect(audio.playbackRate).toBe(1.75);
    expect(audio.preservesPitch).toBe(true);
    ctrl.dispose();
  });

  it('révoque l’URL objet précédente au changement de source', async () => {
    await seedNote('n1', 2);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    await ctrl.next();
    expect(created).toHaveLength(2);
    expect(revoked).toEqual([created[0]]);
    ctrl.dispose();
    expect(revoked).toEqual(created);
  });

  it('sauvegarde la position toutes les 5 s pendant la lecture et à la pause', async () => {
    await seedNote('n1', 2);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    await flush();
    vi.useFakeTimers();
    await ctrl.play();
    audio.currentTime = 12;
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();
    await flush();
    expect((await lib.getProgress('n1'))?.positionSec).toBe(12);
    audio.currentTime = 20;
    ctrl.pause();
    await flush();
    expect((await lib.getProgress('n1'))?.positionSec).toBe(20);
    ctrl.dispose();
  });

  it('marque écouté à 95 % sans doublon', async () => {
    await seedNote('n1', 2);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    await flush();
    audio.currentTime = 94;
    audio.dispatchEvent(new Event('timeupdate'));
    await flush();
    expect((await lib.getProgress('n1'))?.completedChapterIds ?? []).toEqual([]);
    audio.currentTime = 96;
    audio.dispatchEvent(new Event('timeupdate'));
    audio.dispatchEvent(new Event('timeupdate'));
    await flush();
    audio.dispatchEvent(new Event('ended'));
    await flush();
    expect((await lib.getProgress('n1'))?.completedChapterIds).toEqual(['n1-0']);
    ctrl.dispose();
  });

  it('chapitre non prêt : waitingForAudio puis reprise automatique', async () => {
    await lib.saveNote(note('n1'));
    await lib.saveChapter(chapter('n1-0', 'n1', 0, { audioStatus: 'generating' }));
    const ctrl = mk();
    await ctrl.loadNote('n1');
    await ctrl.play();
    let s = last(ctrl);
    expect(s.waitingForAudio).toBe(true);
    expect(s.playing).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
    await lib.putAudio('n1-0', blob());
    await lib.saveChapter(chapter('n1-0', 'n1', 0, { audioStatus: 'ready', audioLocal: true }));
    await flush(40);
    s = last(ctrl);
    expect(s.waitingForAudio).toBe(false);
    expect(s.playing).toBe(true);
    expect(audio.play).toHaveBeenCalled();
    ctrl.dispose();
  });

  it('utilise fetchRemoteAudio quand il n’y a pas d’audio local', async () => {
    await lib.saveNote(note('n1'));
    await lib.saveChapter(chapter('n1-0', 'n1', 0, { audioDriveId: 'drv' }));
    const fetchRemote = vi.fn(async () => blob());
    const ctrl = mk(fetchRemote);
    await ctrl.loadNote('n1');
    await flush();
    expect(fetchRemote).toHaveBeenCalled();
    expect(last(ctrl).waitingForAudio).toBe(false);
    expect(await lib.getAudio('n1-0')).toBeDefined();
    ctrl.dispose();
  });

  it('loadCourse enchaîne les notes dans l’ordre et sauvegarde par note', async () => {
    await seedNote('nb', 1, 'c1', 1);
    await seedNote('na', 2, 'c1', 0);
    const ctrl = mk();
    await ctrl.loadCourse('c1');
    expect(last(ctrl).queue.map((q) => q.chapterId)).toEqual(['na-0', 'na-1', 'nb-0']);
    await ctrl.goTo(2);
    await flush();
    expect((await lib.getProgress('nb'))?.chapterIndex).toBe(0);
    ctrl.dispose();
  });

  it('loadCourse démarre à la première note non terminée', async () => {
    await seedNote('na', 2, 'c1', 0);
    await seedNote('nb', 2, 'c1', 1);
    await lib.saveProgress({ noteId: 'na', chapterIndex: 1, positionSec: 0, completedChapterIds: ['na-0', 'na-1'], updatedAt: 0 });
    const ctrl = mk();
    await ctrl.loadCourse('c1');
    expect(last(ctrl).index).toBe(2);
    ctrl.dispose();
  });

  it('prev : redémarre si > 3 s, sinon chapitre précédent', async () => {
    await seedNote('n1', 2);
    const ctrl = mk();
    await ctrl.loadNote('n1');
    await ctrl.next();
    await flush();
    audio.currentTime = 10;
    await ctrl.prev();
    expect(last(ctrl).index).toBe(1);
    expect(audio.currentTime).toBe(0);
    audio.currentTime = 2;
    await ctrl.prev();
    await flush();
    expect(last(ctrl).index).toBe(0);
    ctrl.dispose();
  });
});

describe('bindMediaSession', () => {
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).mediaSession;
  });

  it('ne fait rien sans mediaSession', async () => {
    await seedNote('n1', 1);
    const ctrl = mk();
    expect(() => bindMediaSession(ctrl)).not.toThrow();
    ctrl.dispose();
  });

  it('pose métadonnées, handlers et position', async () => {
    const handlers: Record<string, (d?: unknown) => void> = {};
    const ms = {
      metadata: null as unknown,
      playbackState: 'none',
      setActionHandler: vi.fn((a: string, h: (d?: unknown) => void) => {
        handlers[a] = h;
      }),
      setPositionState: vi.fn(),
    };
    Object.defineProperty(navigator, 'mediaSession', { value: ms, configurable: true });
    vi.stubGlobal('MediaMetadata', class {
      constructor(public init: unknown) {
        Object.assign(this, init);
      }
    });
    await seedNote('n1', 2);
    const ctrl = mk();
    bindMediaSession(ctrl);
    await ctrl.loadNote('n1');
    await flush();
    expect(ms.metadata).toMatchObject({ title: 'Ch n1-0', artist: 'Note n1', album: 'Cours c1' });
    expect((ms.metadata as { artwork: { src: string }[] }).artwork[0].src).toMatch(/icons\/icon-512\.png$/);
    for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto']) {
      expect(handlers[a]).toBeTypeOf('function');
    }
    audio.currentTime = 30;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(ms.setPositionState).toHaveBeenLastCalledWith({ duration: 100, playbackRate: 1, position: 30 });
    handlers.seekforward({});
    expect(audio.currentTime).toBe(45);
    handlers.seekto({ seekTime: 10 });
    expect(audio.currentTime).toBe(10);
    handlers.nexttrack();
    await flush();
    expect(last(ctrl).index).toBe(1);
    ctrl.dispose();
  });
});
