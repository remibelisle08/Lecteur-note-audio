import { describe, expect, it } from 'vitest';
import { mergeSnapshots } from '../../src/sync/merge';
import type { Chapter, Course, Note, Progress, Snapshot, Tombstone } from '../../src/types';

const empty = (): Snapshot => ({ version: 1, courses: [], notes: [], chapters: [], progress: [], tombstones: [] });
const snap = (over: Partial<Snapshot>): Snapshot => ({ ...empty(), ...over });

const course = (id: string, updatedAt: number, name = 'Cours ' + id): Course => ({ id, name, order: 0, updatedAt });
const note = (id: string, updatedAt: number, over: Partial<Note> = {}): Note => ({
  id, courseId: 'c1', title: 'Note ' + id, sourceFileName: id + '.pdf', order: 0, createdAt: 1, updatedAt,
  status: 'ready', quizMode: false, usedOcr: false, ...over,
});
type SnapChapter = Omit<Chapter, 'audioLocal'>;
const chapter = (id: string, updatedAt: number, over: Partial<SnapChapter> = {}): SnapChapter => ({
  id, noteId: 'n1', index: 0, title: 'Chapitre ' + id, text: 'texte', included: true, audioStatus: 'ready',
  updatedAt, ...over,
});
const progress = (noteId: string, updatedAt: number, positionSec: number): Progress => ({
  noteId, chapterIndex: 0, positionSec, completedChapterIds: [], updatedAt,
});
const tomb = (id: string, kind: Tombstone['kind'], deletedAt: number): Tombstone => ({ id, kind, deletedAt });

const NOW = Date.now();

describe('mergeSnapshots', () => {
  it('entité absente d’un côté → présente', () => {
    const local = snap({ courses: [course('c1', NOW)], notes: [note('n1', NOW)] });
    const remote = snap({ courses: [course('c2', NOW)], chapters: [chapter('ch1', NOW)] });
    const m = mergeSnapshots(local, remote);
    expect(m.version).toBe(1);
    expect(m.courses.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(m.notes.map((n) => n.id)).toEqual(['n1']);
    expect(m.chapters.map((c) => c.id)).toEqual(['ch1']);
  });

  it('même id → updatedAt max gagne (enregistrement entier, flags compris)', () => {
    const local = snap({
      courses: [course('c1', NOW - 10, 'Ancien nom')],
      notes: [note('n1', NOW)],
      chapters: [chapter('ch1', NOW, { title: 'Local', flags: ['has-quiz'] })],
    });
    const remote = snap({
      courses: [course('c1', NOW, 'Nouveau nom')],
      chapters: [chapter('ch1', NOW - 5, { title: 'Distant', flags: ['ocr-low-confidence', 'has-captions'] })],
    });
    const m = mergeSnapshots(local, remote);
    expect(m.courses).toEqual([course('c1', NOW, 'Nouveau nom')]);
    expect(m.chapters).toHaveLength(1);
    expect(m.chapters[0].title).toBe('Local');
    expect(m.chapters[0].flags).toEqual(['has-quiz']);
  });

  it('tombstone avec deletedAt ≥ updatedAt → entité retirée, tombstone conservée', () => {
    const local = snap({ courses: [course('c1', NOW)], notes: [note('n1', NOW - 100)], chapters: [chapter('ch1', NOW - 100)] });
    const remote = snap({ tombstones: [tomb('n1', 'note', NOW - 100), tomb('ch1', 'chapter', NOW - 50)] });
    const m = mergeSnapshots(local, remote);
    expect(m.notes).toEqual([]);
    expect(m.chapters).toEqual([]);
    expect(m.tombstones).toEqual(
      expect.arrayContaining([tomb('n1', 'note', NOW - 100), tomb('ch1', 'chapter', NOW - 50)]),
    );
    expect(m.tombstones).toHaveLength(2);
  });

  it('tombstone plus ancienne qu’une modification → entité conservée', () => {
    const local = snap({ tombstones: [tomb('c1', 'course', NOW - 100)] });
    const remote = snap({ courses: [course('c1', NOW)] });
    const m = mergeSnapshots(local, remote);
    expect(m.courses).toEqual([course('c1', NOW)]);
    expect(m.tombstones).toEqual([tomb('c1', 'course', NOW - 100)]);
  });

  it('tombstones : union, deletedAt max par id, purge après 90 jours', () => {
    const day = 24 * 3600 * 1000;
    const local = snap({ tombstones: [tomb('x', 'note', NOW - 10), tomb('old', 'chapter', NOW - 91 * day)] });
    const remote = snap({ tombstones: [tomb('x', 'note', NOW - 5), tomb('y', 'course', NOW - 1)] });
    const m = mergeSnapshots(local, remote);
    expect(m.tombstones.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      tomb('x', 'note', NOW - 5),
      tomb('y', 'course', NOW - 1),
    ]);
  });

  it('une note supprimée emporte ses chapitres et sa progression', () => {
    const local = snap({ tombstones: [tomb('n1', 'note', NOW)] });
    const remote = snap({
      courses: [course('c1', NOW - 10)],
      notes: [note('n1', NOW - 10)],
      chapters: [chapter('ch1', NOW - 10)],
      progress: [progress('n1', NOW - 10, 42)],
    });
    const m = mergeSnapshots(local, remote);
    expect(m.notes).toEqual([]);
    expect(m.chapters).toEqual([]);
    expect(m.progress).toEqual([]);
  });

  it('cours supprimé d’un côté → ses notes, chapitres et progression retirés (dans les deux sens)', () => {
    const live = snap({
      courses: [course('c1', NOW - 10)],
      notes: [note('n1', NOW - 10)],
      chapters: [chapter('ch1', NOW - 10)],
      progress: [progress('n1', NOW - 10, 3)],
    });
    // Seule la tombstone du cours : notes et chapitres n'ont pas de tombstone propre.
    const deleted = snap({ tombstones: [tomb('c1', 'course', NOW)] });
    for (const m of [mergeSnapshots(live, deleted), mergeSnapshots(deleted, live)]) {
      expect(m.courses).toEqual([]);
      expect(m.notes).toEqual([]);
      expect(m.chapters).toEqual([]);
      expect(m.progress).toEqual([]);
      expect(m.tombstones).toEqual([tomb('c1', 'course', NOW)]);
    }
  });

  it('chapitre dont la note est supprimée → retiré même s’il est plus récent (dans les deux sens)', () => {
    const a = snap({ courses: [course('c1', NOW)], notes: [note('n1', NOW - 10)], chapters: [chapter('ch1', NOW)] });
    const b = snap({ courses: [course('c1', NOW)], tombstones: [tomb('n1', 'note', NOW - 5)] });
    for (const m of [mergeSnapshots(a, b), mergeSnapshots(b, a)]) {
      expect(m.notes).toEqual([]);
      expect(m.chapters).toEqual([]);
    }
  });

  it('progression la plus récente gagne', () => {
    const base = { courses: [course('c1', NOW)], notes: [note('n1', NOW)] };
    const local = snap({ ...base, progress: [progress('n1', NOW - 30, 10)] });
    const remote = snap({ ...base, progress: [progress('n1', NOW, 95)] });
    expect(mergeSnapshots(local, remote).progress).toEqual([progress('n1', NOW, 95)]);
    expect(mergeSnapshots(remote, local).progress).toEqual([progress('n1', NOW, 95)]);
  });

  it('audioDriveId défini d’un côté seulement → conservé (pas d’écrasement par undefined)', () => {
    const base = { courses: [course('c1', NOW)], notes: [note('n1', NOW)] };
    const local = snap({ ...base, chapters: [chapter('ch1', NOW, { title: 'Renommé' })] });
    const remote = snap({ ...base, chapters: [chapter('ch1', NOW - 10, { audioDriveId: 'drive-1' })] });
    const m = mergeSnapshots(local, remote);
    expect(m.chapters[0].title).toBe('Renommé');
    expect(m.chapters[0].audioDriveId).toBe('drive-1');
    const m2 = mergeSnapshots(remote, local);
    expect(m2.chapters[0].audioDriveId).toBe('drive-1');
  });
});
