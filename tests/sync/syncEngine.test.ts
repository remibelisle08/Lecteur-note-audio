import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLibrary, type Library } from '../../src/library/db';
import { DriveAuthError, type DriveApi } from '../../src/sync/driveClient';
import { SyncEngine, type SyncStatus } from '../../src/sync/syncEngine';
import { DEFAULT_SETTINGS, type Chapter, type Note, type Settings, type Snapshot } from '../../src/types';

let n = 0;
const openTestLibrary = () => openLibrary(`sync-${Date.now()}-${n++}`);

const NOW = Date.now();
const note = (id: string, over: Partial<Note> = {}): Note => ({
  id, courseId: 'c1', title: 'Note ' + id, sourceFileName: id + '.pdf', order: 0, createdAt: 1, updatedAt: NOW,
  status: 'ready', quizMode: false, usedOcr: false, ...over,
});
const chapter = (id: string, over: Partial<Chapter> = {}): Chapter => ({
  id, noteId: 'n1', index: 0, title: 'Chapitre ' + id, text: 'texte', included: true, audioStatus: 'ready',
  audioLocal: false, updatedAt: NOW, ...over,
});
const course1 = { id: 'c1', name: 'Cours', order: 0, updatedAt: NOW };
const emptySnap = (): Snapshot => ({ version: 1, courses: [], notes: [], chapters: [], progress: [], tombstones: [] });

function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

/** DriveApi en mémoire. */
function fakeDrive(initialLibrary: string | null = null) {
  let library = initialLibrary;
  /** Numéro de version Drive de library.json (incrémenté à chaque écriture). */
  let version = initialLibrary === null ? 0 : 1;
  const files = new Map<string, Blob>();
  let next = 1;
  const api = {
    ensureFolder: vi.fn(async () => 'folder-1'),
    libraryVersion: vi.fn(async (_folderId: string) => (library === null ? null : String(version))),
    readLibrary: vi.fn(async (_folderId: string) => library),
    writeLibrary: vi.fn(async (_folderId: string, json: string) => {
      library = json;
      version++;
      return String(version);
    }),
    uploadAudio: vi.fn(async (_folderId: string, _chapterId: string, blob: Blob) => {
      const id = `file-${next++}`;
      files.set(id, blob);
      return id;
    }),
    downloadAudio: vi.fn(async (fileId: string) => {
      const b = files.get(fileId);
      if (!b) throw new Error('introuvable');
      return b;
    }),
    deleteFile: vi.fn(async (fileId: string) => {
      files.delete(fileId);
    }),
  } satisfies DriveApi;
  return {
    api,
    files,
    get library() {
      return library;
    },
    /** Écriture par un autre appareil. */
    externalWrite(json: string) {
      library = json;
      version++;
    },
  };
}

const settings = (over: Partial<Settings> = {}) => async (): Promise<Settings> => ({ ...DEFAULT_SETTINGS, ...over });

afterEach(() => {
  vi.useRealTimers();
});

async function seedNote(lib: Library) {
  await lib.saveCourse({ id: 'c1', name: 'Cours', order: 0, updatedAt: 0 });
  await lib.saveNote(note('n1'));
}

describe('SyncEngine.syncNow', () => {
  it('distant absent → écrit le local', async () => {
    const lib = await openTestLibrary();
    await seedNote(lib);
    const drive = fakeDrive(null);
    const engine = new SyncEngine(lib, drive.api, settings());
    const statuses: SyncStatus[] = [];
    engine.onStatus((s) => statuses.push(s));

    const res = await engine.syncNow();
    expect(res.ok).toBe(true);
    expect(drive.api.writeLibrary).toHaveBeenCalledTimes(1);
    const written = JSON.parse(drive.library!) as Snapshot;
    expect(written.version).toBe(1);
    expect(written.courses.map((c) => c.id)).toEqual(['c1']);
    expect(written.notes.map((x) => x.id)).toEqual(['n1']);
    const last = statuses[statuses.length - 1];
    expect(last.state).toBe('idle');
    expect(last.lastSyncAt).toBeGreaterThan(0);
    expect(statuses.some((s) => s.state === 'syncing')).toBe(true);
  });

  it('distant corrompu → état error, aucune écriture', async () => {
    const lib = await openTestLibrary();
    await seedNote(lib);
    const drive = fakeDrive('{oops');
    const engine = new SyncEngine(lib, drive.api, settings());
    const applySpy = vi.spyOn(lib, 'applySnapshot');
    const mergeSpy = vi.spyOn(lib, 'mergeRemote');
    const statuses: SyncStatus[] = [];
    engine.onStatus((s) => statuses.push(s));

    const res = await engine.syncNow();
    expect(res.ok).toBe(false);
    expect(statuses[statuses.length - 1]).toEqual({
      state: 'error',
      message: 'Le fichier de synchro sur Drive est illisible. Rien n’a été modifié.',
    });
    expect(drive.api.writeLibrary).not.toHaveBeenCalled();
    expect(drive.api.uploadAudio).not.toHaveBeenCalled();
    expect(drive.api.deleteFile).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  it('distant de mauvaise version ou incomplet → error, aucune écriture', async () => {
    for (const raw of ['{"version":2,"courses":[],"notes":[],"chapters":[],"progress":[],"tombstones":[]}', '{"version":1}']) {
      const lib = await openTestLibrary();
      const drive = fakeDrive(raw);
      const engine = new SyncEngine(lib, drive.api, settings());
      const res = await engine.syncNow();
      expect(res.ok).toBe(false);
      expect(drive.api.writeLibrary).not.toHaveBeenCalled();
    }
  });

  it('fusionne le distant dans la bibliothèque locale', async () => {
    const lib = await openTestLibrary();
    await seedNote(lib);
    const remote = { ...emptySnap(), notes: [note('n2', { title: 'Depuis le téléphone' })] };
    const drive = fakeDrive(JSON.stringify(remote));
    await new SyncEngine(lib, drive.api, settings()).syncNow();
    expect((await lib.listNotes('c1')).map((x) => x.id).sort()).toEqual(['n1', 'n2']);
    expect((JSON.parse(drive.library!) as Snapshot).notes).toHaveLength(2);
  });

  it('écriture locale concurrente (entre lecture du distant et fusion) → conservée, audio compris', async () => {
    const real = await openTestLibrary();
    await seedNote(real);
    const drive = fakeDrive(JSON.stringify({ ...emptySnap(), courses: [course1], notes: [note('n2')] }));
    // Juste avant la fusion (après la lecture du distant), le générateur termine un chapitre.
    const lib: Library = {
      ...real,
      mergeRemote: async (remote, merge) => {
        await real.saveChapter(chapter('fresh', { audioStatus: 'ready' }));
        await real.putAudio('fresh', new Blob(['neuf'], { type: 'audio/mpeg' }));
        return real.mergeRemote(remote, merge);
      },
    };
    await new SyncEngine(lib, drive.api, settings()).syncNow();
    const chs = await real.listChapters('n1');
    expect(chs.map((c) => c.id)).toEqual(['fresh']);
    expect(chs[0].audioStatus).toBe('ready');
    const blob = await real.getAudio('fresh');
    expect(blob && (await readText(blob))).toBe('neuf');
    expect((await real.listNotes('c1')).map((x) => x.id).sort()).toEqual(['n1', 'n2']);
    expect(drive.api.uploadAudio).toHaveBeenCalledWith('folder-1', 'fresh', expect.any(Blob));
  });

  it('audio local sans audioDriveId → téléversé puis audioDriveId enregistré', async () => {
    const lib = await openTestLibrary();
    await seedNote(lib);
    await lib.saveChapter(chapter('ch1'));
    await lib.putAudio('ch1', new Blob(['mp3-data'], { type: 'audio/mpeg' }));
    const drive = fakeDrive(null);
    await new SyncEngine(lib, drive.api, settings()).syncNow();

    expect(drive.api.uploadAudio).toHaveBeenCalledTimes(1);
    expect(drive.api.uploadAudio.mock.calls[0][0]).toBe('folder-1');
    expect(drive.api.uploadAudio.mock.calls[0][1]).toBe('ch1');
    const [ch] = await lib.listChapters('n1');
    expect(ch.audioDriveId).toBe('file-1');
    expect(ch.audioLocal).toBe(true);
    expect((JSON.parse(drive.library!) as Snapshot).chapters[0].audioDriveId).toBe('file-1');
  });

  it('chapitre distant ready avec audioDriveId, sans audio local, autoDownloadAudio: true → téléchargé', async () => {
    const lib = await openTestLibrary();
    const drive = fakeDrive();
    drive.files.set('file-9', new Blob(['distant'], { type: 'audio/mpeg' }));
    const { audioLocal: _a, ...remoteCh } = chapter('ch1', { audioDriveId: 'file-9' });
    await drive.api.writeLibrary('folder-1', JSON.stringify({ ...emptySnap(), courses: [course1], notes: [note('n1')], chapters: [remoteCh] }));
    drive.api.writeLibrary.mockClear();

    await new SyncEngine(lib, drive.api, settings({ autoDownloadAudio: true })).syncNow();
    expect(drive.api.downloadAudio).toHaveBeenCalledWith('file-9');
    const blob = await lib.getAudio('ch1');
    expect(blob && (await readText(blob))).toBe('distant');
    expect((await lib.listChapters('n1'))[0].audioLocal).toBe(true);
  });

  it('autoDownloadAudio: false → non téléchargé', async () => {
    const lib = await openTestLibrary();
    const drive = fakeDrive();
    drive.files.set('file-9', new Blob(['distant'], { type: 'audio/mpeg' }));
    const { audioLocal: _a, ...remoteCh } = chapter('ch1', { audioDriveId: 'file-9' });
    await drive.api.writeLibrary('folder-1', JSON.stringify({ ...emptySnap(), courses: [course1], notes: [note('n1')], chapters: [remoteCh] }));

    await new SyncEngine(lib, drive.api, settings({ autoDownloadAudio: false })).syncNow();
    expect(drive.api.downloadAudio).not.toHaveBeenCalled();
    expect(await lib.getAudio('ch1')).toBeUndefined();
    expect((await lib.listChapters('n1'))[0].audioDriveId).toBe('file-9');
  });

  it('chapitre déjà écouté → pas retéléchargé (audio libéré)', async () => {
    const lib = await openTestLibrary();
    const drive = fakeDrive();
    drive.files.set('file-9', new Blob(['distant'], { type: 'audio/mpeg' }));
    const { audioLocal: _a, ...remoteCh } = chapter('ch1', { audioDriveId: 'file-9' });
    const progress = { noteId: 'n1', chapterIndex: 0, positionSec: 0, completedChapterIds: ['ch1'], updatedAt: NOW };
    await drive.api.writeLibrary(
      'folder-1',
      JSON.stringify({ ...emptySnap(), courses: [course1], notes: [note('n1')], chapters: [remoteCh], progress: [progress] }),
    );

    await new SyncEngine(lib, drive.api, settings({ autoDownloadAudio: true })).syncNow();
    expect(drive.api.downloadAudio).not.toHaveBeenCalled();
  });

  it('tombstone de note → fichiers audio Drive supprimés', async () => {
    const lib = await openTestLibrary();
    await seedNote(lib);
    await lib.saveChapter(chapter('ch1', { audioDriveId: 'file-1' }));
    await lib.saveChapter(chapter('ch2', { index: 1, audioDriveId: 'file-2' }));
    const drive = fakeDrive();
    drive.files.set('file-1', new Blob(['a']));
    drive.files.set('file-2', new Blob(['b']));
    const engine = new SyncEngine(lib, drive.api, settings());
    await engine.syncNow(); // le distant connaît maintenant la note et ses chapitres
    expect(drive.api.deleteFile).not.toHaveBeenCalled();

    await lib.deleteNote('n1');
    await engine.syncNow();
    expect(drive.api.deleteFile.mock.calls.map((c) => c[0]).sort()).toEqual(['file-1', 'file-2']);
    const written = JSON.parse(drive.library!) as Snapshot;
    expect(written.notes).toEqual([]);
    expect(written.chapters).toEqual([]);
    expect(written.tombstones.map((t) => t.id)).toContain('n1');
  });

  it('DriveAuthError → auth-required', async () => {
    const lib = await openTestLibrary();
    const drive = fakeDrive();
    drive.api.libraryVersion.mockRejectedValueOnce(new DriveAuthError());
    const engine = new SyncEngine(lib, drive.api, settings());
    const statuses: SyncStatus[] = [];
    engine.onStatus((s) => statuses.push(s));
    const res = await engine.syncNow();
    expect(res.ok).toBe(false);
    expect(statuses[statuses.length - 1].state).toBe('auth-required');
    expect(drive.api.writeLibrary).not.toHaveBeenCalled();
  });

  it('autre erreur réseau → error avec message, sans écriture', async () => {
    const lib = await openTestLibrary();
    const drive = fakeDrive();
    drive.api.ensureFolder.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const engine = new SyncEngine(lib, drive.api, settings());
    const statuses: SyncStatus[] = [];
    engine.onStatus((s) => statuses.push(s));
    await engine.syncNow();
    const last = statuses[statuses.length - 1];
    expect(last.state).toBe('error');
    expect(last.message).toBeTruthy();
    expect(drive.api.writeLibrary).not.toHaveBeenCalled();
  });

  it('une seule synchro à la fois ; les demandes pendant une synchro en déclenchent une seule après', async () => {
    const lib = await openTestLibrary();
    const drive = fakeDrive();
    let release!: () => void;
    drive.api.libraryVersion.mockImplementationOnce(() => new Promise((r) => (release = () => r(null))));
    const engine = new SyncEngine(lib, drive.api, settings());
    const first = engine.syncNow();
    await vi.waitFor(() => expect(drive.api.libraryVersion).toHaveBeenCalledTimes(1));
    const second = engine.syncNow();
    const third = engine.syncNow();
    expect(second).toBe(third);
    release();
    await Promise.all([first, second, third]);
    expect(drive.api.libraryVersion).toHaveBeenCalledTimes(2);
  });

  it('version distante inchangée → pas de téléchargement ; local inchangé → pas de téléversement', async () => {
    const lib = await openTestLibrary();
    await seedNote(lib);
    const drive = fakeDrive(JSON.stringify({ ...emptySnap(), courses: [course1], notes: [note('n2')] }));
    const engine = new SyncEngine(lib, drive.api, settings());
    await engine.syncNow();
    expect(drive.api.readLibrary).toHaveBeenCalledTimes(1);
    expect(drive.api.writeLibrary).toHaveBeenCalledTimes(1); // n1 local publié

    // Rien n'a changé, ni ici ni sur Drive : ni téléchargement ni téléversement.
    const res = await engine.syncNow();
    expect(res.ok).toBe(true);
    expect(drive.api.readLibrary).toHaveBeenCalledTimes(1);
    expect(drive.api.writeLibrary).toHaveBeenCalledTimes(1);

    // Changement local (progression) : téléversé, sans retélécharger le distant.
    await lib.saveProgress({ noteId: 'n1', chapterIndex: 0, positionSec: 42, completedChapterIds: [], updatedAt: 0 });
    await engine.syncNow();
    expect(drive.api.readLibrary).toHaveBeenCalledTimes(1);
    expect(drive.api.writeLibrary).toHaveBeenCalledTimes(2);
    expect((JSON.parse(drive.library!) as Snapshot).progress[0].positionSec).toBe(42);

    // Écriture d'un autre appareil : nouvelle version → téléchargée et fusionnée.
    const remote = JSON.parse(drive.library!) as Snapshot;
    drive.externalWrite(JSON.stringify({ ...remote, notes: [...remote.notes, note('n3')] }));
    await engine.syncNow();
    expect(drive.api.readLibrary).toHaveBeenCalledTimes(2);
    expect((await lib.listNotes('c1')).map((x) => x.id).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(drive.api.writeLibrary).toHaveBeenCalledTimes(2); // déjà à jour : rien à republier
  });

  it('ses propres écritures ne relancent pas de synchro', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const lib = await openTestLibrary();
    await seedNote(lib);
    await lib.saveChapter(chapter('ch1'));
    await lib.putAudio('ch1', new Blob(['x'], { type: 'audio/mpeg' }));
    const drive = fakeDrive(JSON.stringify({ ...emptySnap(), notes: [note('n2')] }));
    const engine = new SyncEngine(lib, drive.api, settings());
    engine.start();
    await vi.waitFor(() => expect(drive.api.writeLibrary).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(drive.api.readLibrary).toHaveBeenCalledTimes(1);
    engine.stop();
  });
});

describe('SyncEngine — déclencheurs', () => {
  async function setup() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const lib = await openTestLibrary();
    const engine = new SyncEngine(lib, fakeDrive().api, settings());
    const sync = vi.spyOn(engine, 'syncNow').mockResolvedValue({ ok: true, uploaded: 0, downloaded: 0, deleted: 0 });
    return { lib, engine, sync };
  }

  it('start() : synchro immédiate, puis à l’événement online', async () => {
    const { engine, sync } = await setup();
    engine.start();
    expect(sync).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(2);
    engine.stop();
    window.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('modification locale → syncNow une fois après 5 s malgré 3 changements', async () => {
    const { lib, engine, sync } = await setup();
    engine.start();
    sync.mockClear();
    await lib.saveCourse({ id: 'a', name: 'A', order: 0, updatedAt: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    await lib.saveCourse({ id: 'b', name: 'B', order: 1, updatedAt: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    await lib.saveCourse({ id: 'c', name: 'C', order: 2, updatedAt: 0 });
    await vi.advanceTimersByTimeAsync(4999);
    expect(sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sync).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('changement progress → synchro au plus toutes les 30 s', async () => {
    const { lib, engine, sync } = await setup();
    engine.start(); // synchro immédiate à t = 0
    sync.mockClear();
    const p = { noteId: 'n1', chapterIndex: 0, positionSec: 0, completedChapterIds: [], updatedAt: 0 };
    for (let t = 0; t < 12; t++) {
      await lib.saveProgress({ ...p, positionSec: t * 5 });
      await vi.advanceTimersByTimeAsync(5000);
    } // 60 s d'écoute, position toutes les 5 s
    expect(sync).toHaveBeenCalledTimes(2); // à 30 s et à 60 s
    engine.stop();
    await lib.saveProgress(p);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('page masquée : synchro de progression au plus toutes les 5 min ; une synchro au passage en arrière-plan', async () => {
    const { lib, engine, sync } = await setup();
    let hidden = false;
    const spy = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    engine.start();
    sync.mockClear();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sync).toHaveBeenCalledTimes(1); // vidage au passage en arrière-plan
    sync.mockClear();
    const p = { noteId: 'n1', chapterIndex: 0, positionSec: 0, completedChapterIds: [], updatedAt: 0 };
    for (let t = 0; t < 120; t++) {
      await lib.saveProgress({ ...p, positionSec: t * 5 });
      await vi.advanceTimersByTimeAsync(5000);
    } // 10 min d'écoute écran verrouillé
    expect(sync).toHaveBeenCalledTimes(2); // à 5 min et à 10 min
    // Une modification de la bibliothèque garde son délai de 5 s.
    sync.mockClear();
    await lib.saveCourse({ id: 'a', name: 'A', order: 0, updatedAt: 0 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sync).toHaveBeenCalledTimes(1);
    engine.stop();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sync).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('stop() annule une synchro en attente', async () => {
    const { lib, engine, sync } = await setup();
    engine.start();
    sync.mockClear();
    await lib.saveCourse({ id: 'a', name: 'A', order: 0, updatedAt: 0 });
    engine.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sync).not.toHaveBeenCalled();
  });
});
