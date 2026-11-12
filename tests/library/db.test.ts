import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openLibrary, newId, type Library } from '../../src/library/db';
import { DEFAULT_SETTINGS, type Chapter, type Course, type Note } from '../../src/types';

let n = 0;
let lib: Library;
beforeEach(async () => {
  lib = await openLibrary('test-' + n++);
});

const course = (id: string, order = 0): Course => ({ id, name: 'Cours ' + id, order, updatedAt: 0 });
const note = (id: string, courseId = 'c1', order = 0): Note => ({
  id, courseId, title: 'Note ' + id, sourceFileName: id + '.pdf', order, createdAt: 1, updatedAt: 0,
  status: 'ready', quizMode: false, usedOcr: false,
});
const chapter = (id: string, noteId: string, index: number, over: Partial<Chapter> = {}): Chapter => ({
  id, noteId, index, title: 'Ch ' + id, text: 'texte', included: true,
  audioStatus: 'ready', audioLocal: false, updatedAt: 0, ...over,
});
const blob = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' });

describe('library', () => {
  it('newId renvoie des identifiants distincts', () => {
    expect(newId()).not.toBe(newId());
  });

  it('CRUD cours trié par order, updatedAt posé sans muter', async () => {
    const b = course('b', 2);
    await lib.saveCourse(b);
    const a = await lib.saveCourse(course('a', 1));
    expect(b.updatedAt).toBe(0);
    expect(a.updatedAt).toBeGreaterThan(0);
    expect((await lib.listCourses()).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('notes par cours, getNote, chapitres triés par index', async () => {
    await lib.saveNote(note('n1'));
    await lib.saveNote(note('n2', 'c2'));
    expect((await lib.listNotes('c1')).map((x) => x.id)).toEqual(['n1']);
    expect((await lib.getNote('n1'))?.title).toBe('Note n1');
    expect(await lib.getNote('zz')).toBeUndefined();
    await lib.saveChapter(chapter('k2', 'n1', 1));
    await lib.saveChapter(chapter('k1', 'n1', 0));
    expect((await lib.listChapters('n1')).map((x) => x.id)).toEqual(['k1', 'k2']);
  });

  it('putAudio / getAudio / deleteAudio basculent audioLocal sans toucher updatedAt', async () => {
    const saved = await lib.saveChapter(chapter('k1', 'n1', 0));
    await lib.putAudio('k1', blob());
    let ch = (await lib.listChapters('n1'))[0];
    expect(ch.audioLocal).toBe(true);
    expect(ch.updatedAt).toBe(saved.updatedAt);
    const got = await lib.getAudio('k1');
    expect(got?.type).toBe('audio/mpeg');
    expect(got?.size).toBe(4);
    await lib.deleteAudio('k1');
    ch = (await lib.listChapters('n1'))[0];
    expect(ch.audioLocal).toBe(false);
    expect(await lib.getAudio('k1')).toBeUndefined();
  });

  it('deleteNote cascade chapitres, audio, progression + tombstones', async () => {
    await lib.saveNote(note('n1'));
    await lib.saveChapter(chapter('k1', 'n1', 0));
    await lib.putAudio('k1', blob());
    await lib.saveProgress({ noteId: 'n1', chapterIndex: 0, positionSec: 3, completedChapterIds: [], updatedAt: 0 });
    await lib.deleteNote('n1');
    expect(await lib.getNote('n1')).toBeUndefined();
    expect(await lib.listChapters('n1')).toEqual([]);
    expect(await lib.getAudio('k1')).toBeUndefined();
    expect(await lib.getProgress('n1')).toBeUndefined();
    const snap = await lib.exportSnapshot();
    expect(snap.tombstones.map((t) => t.kind + ':' + t.id).sort()).toEqual(['chapter:k1', 'note:n1']);
  });

  it('deleteCourse cascade vers les notes', async () => {
    await lib.saveCourse(course('c1'));
    await lib.saveNote(note('n1'));
    await lib.saveChapter(chapter('k1', 'n1', 0));
    await lib.deleteCourse('c1');
    expect(await lib.listCourses()).toEqual([]);
    expect(await lib.listNotes('c1')).toEqual([]);
    expect(await lib.listChapters('n1')).toEqual([]);
    const t = (await lib.exportSnapshot()).tombstones.map((x) => x.kind + ':' + x.id).sort();
    expect(t).toEqual(['chapter:k1', 'course:c1', 'note:n1']);
  });

  it('deleteChapter supprime audio et pose un tombstone', async () => {
    await lib.saveChapter(chapter('k1', 'n1', 0));
    await lib.putAudio('k1', blob());
    await lib.deleteChapter('k1');
    expect(await lib.getAudio('k1')).toBeUndefined();
    expect((await lib.exportSnapshot()).tombstones.map((t) => t.id)).toEqual(['k1']);
  });

  it('settings : défaut puis fusion', async () => {
    expect(await lib.getSettings()).toEqual(DEFAULT_SETTINGS);
    await lib.saveSettings({ ...DEFAULT_SETTINGS, defaultRate: 1.5 });
    expect((await lib.getSettings()).defaultRate).toBe(1.5);
  });

  it('recoverInterrupted remet les chapitres generating en pending', async () => {
    await lib.saveNote({ ...note('n1'), status: 'generating' });
    await lib.saveChapter(chapter('k1', 'n1', 0, { audioStatus: 'generating' }));
    await lib.saveChapter(chapter('k2', 'n1', 1, { audioStatus: 'generating' }));
    await lib.saveChapter(chapter('k3', 'n1', 2, { audioStatus: 'ready' }));
    expect(await lib.recoverInterrupted()).toBe(2);
    expect((await lib.listChapters('n1')).map((c) => c.audioStatus)).toEqual(['pending', 'pending', 'ready']);
    expect((await lib.getNote('n1'))?.status).toBe('generating');
    expect(await lib.recoverInterrupted()).toBe(0);
  });

  it('exportSnapshot sans audioLocal', async () => {
    await lib.saveChapter(chapter('k1', 'n1', 0));
    await lib.putAudio('k1', blob());
    const s = await lib.exportSnapshot();
    expect(s.version).toBe(1);
    expect(s.chapters).toHaveLength(1);
    expect('audioLocal' in s.chapters[0]).toBe(false);
  });

  it('applySnapshot remplace, préserve audioLocal, supprime l audio des chapitres tombés', async () => {
    await lib.saveCourse(course('c1'));
    await lib.saveCourse(course('old'));
    await lib.saveNote(note('n1'));
    await lib.saveChapter(chapter('k1', 'n1', 0));
    await lib.saveChapter(chapter('k2', 'n1', 1));
    await lib.putAudio('k1', blob());
    await lib.putAudio('k2', blob());
    const snap = await lib.exportSnapshot();
    const remote = {
      ...snap,
      courses: snap.courses.filter((c) => c.id === 'c1'),
      chapters: [
        { ...snap.chapters.find((c) => c.id === 'k1')!, title: 'Distant' },
        { ...snap.chapters.find((c) => c.id === 'k2')!, id: 'k3' },
      ],
      tombstones: [{ id: 'old', kind: 'course' as const, deletedAt: 5 }],
    };
    let events = 0;
    lib.onChange(() => events++);
    await lib.applySnapshot(remote);
    expect(events).toBe(1);
    expect((await lib.listCourses()).map((c) => c.id)).toEqual(['c1']);
    const chs = await lib.listChapters('n1');
    expect(chs.map((c) => c.id)).toEqual(['k1', 'k3']);
    expect(chs[0].title).toBe('Distant');
    expect(chs[0].audioLocal).toBe(true);
    expect(chs[1].audioLocal).toBe(false);
    expect(await lib.getAudio('k2')).toBeUndefined();
    expect(await lib.getAudio('k1')).toBeDefined();
    expect((await lib.exportSnapshot()).tombstones).toEqual(remote.tombstones);
  });

  it('onChange : progress puis library, désabonnement', async () => {
    const seen: string[] = [];
    const off = lib.onChange((k) => seen.push(k));
    await lib.saveProgress({ noteId: 'n1', chapterIndex: 0, positionSec: 1, completedChapterIds: [], updatedAt: 0 });
    await lib.saveNote(note('n1'));
    expect(seen).toEqual(['progress', 'library']);
    off();
    await lib.saveNote(note('n2'));
    expect(seen).toHaveLength(2);
  });
});
