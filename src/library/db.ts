import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import {
  DEFAULT_SETTINGS,
  type Chapter,
  type Course,
  type Note,
  type Progress,
  type Settings,
  type Snapshot,
  type Tombstone,
} from '../types';

export type ChangeKind = 'library' | 'progress';

export interface Library {
  listCourses(): Promise<Course[]>;
  saveCourse(c: Course): Promise<Course>;
  deleteCourse(id: string): Promise<void>;
  listNotes(courseId: string): Promise<Note[]>;
  getNote(id: string): Promise<Note | undefined>;
  saveNote(n: Note): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  listChapters(noteId: string): Promise<Chapter[]>;
  saveChapter(ch: Chapter): Promise<Chapter>;
  deleteChapter(id: string): Promise<void>;
  putAudio(chapterId: string, blob: Blob): Promise<void>;
  getAudio(chapterId: string): Promise<Blob | undefined>;
  deleteAudio(chapterId: string): Promise<void>;
  getProgress(noteId: string): Promise<Progress | undefined>;
  saveProgress(p: Progress): Promise<Progress>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<Settings>;
  recoverInterrupted(): Promise<number>;
  exportSnapshot(): Promise<Snapshot>;
  applySnapshot(s: Snapshot): Promise<void>;
  onChange(listener: (kind: ChangeKind) => void): () => void;
}

/** Audio stocké comme { type, data: ArrayBuffer } : robuste face au clonage structuré des Blob (jsdom / fake-indexeddb). */
type StoredAudio = { chapterId: string; type: string; data: ArrayBuffer };

interface LibSchema extends DBSchema {
  courses: { key: string; value: Course };
  notes: { key: string; value: Note; indexes: { courseId: string } };
  chapters: { key: string; value: Chapter; indexes: { noteId: string } };
  progress: { key: string; value: Progress };
  audio: { key: string; value: StoredAudio };
  meta: { key: string; value: Settings };
  tombstones: { key: string; value: Tombstone };
}

export function newId(): string {
  return crypto.randomUUID();
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

export async function openLibrary(name = 'lecteur-notes'): Promise<Library> {
  const db: IDBPDatabase<LibSchema> = await openDB<LibSchema>(name, 1, {
    upgrade(d) {
      d.createObjectStore('courses', { keyPath: 'id' });
      d.createObjectStore('notes', { keyPath: 'id' }).createIndex('courseId', 'courseId');
      d.createObjectStore('chapters', { keyPath: 'id' }).createIndex('noteId', 'noteId');
      d.createObjectStore('progress', { keyPath: 'noteId' });
      d.createObjectStore('audio', { keyPath: 'chapterId' });
      d.createObjectStore('meta');
      d.createObjectStore('tombstones', { keyPath: 'id' });
    },
  });

  try {
    void Promise.resolve(navigator.storage?.persist?.()).catch(() => undefined);
  } catch {
    /* stockage persistant non disponible : ignoré */
  }

  const listeners = new Set<(kind: ChangeKind) => void>();
  const emit = (kind: ChangeKind) => listeners.forEach((l) => l(kind));

  type StoreName = 'courses' | 'notes' | 'chapters' | 'progress' | 'audio' | 'meta' | 'tombstones';
  type Tx = IDBPTransaction<LibSchema, StoreName[], 'readwrite'>;
  const ALL: StoreName[] = ['courses', 'notes', 'chapters', 'progress', 'audio', 'meta', 'tombstones'];
  const rw = (): Tx => db.transaction(ALL, 'readwrite');

  async function removeChapter(tx: Tx, id: string, now: number) {
    await tx.objectStore('chapters').delete(id);
    await tx.objectStore('audio').delete(id);
    await tx.objectStore('tombstones').put({ id, kind: 'chapter', deletedAt: now });
  }
  async function removeNote(tx: Tx, id: string, now: number) {
    const chapters = await tx.objectStore('chapters').index('noteId').getAllKeys(id);
    for (const cid of chapters) await removeChapter(tx, cid, now);
    await tx.objectStore('progress').delete(id);
    await tx.objectStore('notes').delete(id);
    await tx.objectStore('tombstones').put({ id, kind: 'note', deletedAt: now });
  }

  return {
    async listCourses() {
      return (await db.getAll('courses')).sort((a, b) => a.order - b.order);
    },
    async saveCourse(c) {
      const stored = { ...c, updatedAt: Date.now() };
      await db.put('courses', stored);
      emit('library');
      return stored;
    },
    async deleteCourse(id) {
      const tx = rw();
      const now = Date.now();
      const noteIds = await tx.objectStore('notes').index('courseId').getAllKeys(id);
      for (const nid of noteIds) await removeNote(tx, nid, now);
      await tx.objectStore('courses').delete(id);
      await tx.objectStore('tombstones').put({ id, kind: 'course', deletedAt: now });
      await tx.done;
      emit('library');
    },
    async listNotes(courseId) {
      return (await db.getAllFromIndex('notes', 'courseId', courseId)).sort((a, b) => a.order - b.order);
    },
    getNote: (id) => db.get('notes', id),
    async saveNote(n) {
      const stored = { ...n, updatedAt: Date.now() };
      await db.put('notes', stored);
      emit('library');
      return stored;
    },
    async deleteNote(id) {
      const tx = rw();
      await removeNote(tx, id, Date.now());
      await tx.done;
      emit('library');
    },
    async listChapters(noteId) {
      return (await db.getAllFromIndex('chapters', 'noteId', noteId)).sort((a, b) => a.index - b.index);
    },
    async saveChapter(ch) {
      const stored = { ...ch, updatedAt: Date.now() };
      await db.put('chapters', stored);
      emit('library');
      return stored;
    },
    async deleteChapter(id) {
      const tx = rw();
      await removeChapter(tx, id, Date.now());
      await tx.done;
      emit('library');
    },
    async putAudio(chapterId, blob) {
      const data = await readBlob(blob);
      const tx = rw();
      await tx.objectStore('audio').put({ chapterId, type: blob.type, data });
      const ch = await tx.objectStore('chapters').get(chapterId);
      if (ch) await tx.objectStore('chapters').put({ ...ch, audioLocal: true });
      await tx.done;
      emit('library');
    },
    async getAudio(chapterId) {
      const a = await db.get('audio', chapterId);
      return a ? new Blob([a.data], { type: a.type }) : undefined;
    },
    async deleteAudio(chapterId) {
      const tx = rw();
      await tx.objectStore('audio').delete(chapterId);
      const ch = await tx.objectStore('chapters').get(chapterId);
      if (ch) await tx.objectStore('chapters').put({ ...ch, audioLocal: false });
      await tx.done;
      emit('library');
    },
    getProgress: (noteId) => db.get('progress', noteId),
    async saveProgress(p) {
      const stored = { ...p, updatedAt: Date.now() };
      await db.put('progress', stored);
      emit('progress');
      return stored;
    },
    async getSettings() {
      const s = await db.get('meta', 'settings');
      return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
    },
    async saveSettings(s) {
      await db.put('meta', s, 'settings');
      emit('library');
      return s;
    },
    async recoverInterrupted() {
      const tx = rw();
      let count = 0;
      for (const ch of await tx.objectStore('chapters').getAll()) {
        if (ch.audioStatus === 'generating') {
          await tx.objectStore('chapters').put({ ...ch, audioStatus: 'pending' });
          count++;
        }
      }
      await tx.done;
      if (count > 0) emit('library');
      return count;
    },
    async exportSnapshot() {
      const tx = db.transaction(['courses', 'notes', 'chapters', 'progress', 'tombstones']);
      const [courses, notes, chapters, progress, tombstones] = await Promise.all([
        tx.objectStore('courses').getAll(),
        tx.objectStore('notes').getAll(),
        tx.objectStore('chapters').getAll(),
        tx.objectStore('progress').getAll(),
        tx.objectStore('tombstones').getAll(),
      ]);
      return {
        version: 1,
        courses,
        notes,
        chapters: chapters.map(({ audioLocal: _audioLocal, ...rest }) => rest),
        progress,
        tombstones,
      };
    },
    async applySnapshot(s) {
      const tx = rw();
      const local = new Map<string, boolean>();
      for (const ch of await tx.objectStore('chapters').getAll()) local.set(ch.id, ch.audioLocal);
      const keep = new Set(s.chapters.map((c) => c.id));
      for (const id of local.keys()) if (!keep.has(id)) await tx.objectStore('audio').delete(id);
      for (const store of ['courses', 'notes', 'chapters', 'progress', 'tombstones'] as const) {
        await tx.objectStore(store).clear();
      }
      for (const c of s.courses) await tx.objectStore('courses').put(c);
      for (const n of s.notes) await tx.objectStore('notes').put(n);
      for (const c of s.chapters) {
        await tx.objectStore('chapters').put({ ...c, audioLocal: local.get(c.id) ?? false });
      }
      for (const p of s.progress) await tx.objectStore('progress').put(p);
      for (const t of s.tombstones) await tx.objectStore('tombstones').put(t);
      await tx.done;
      emit('library');
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
