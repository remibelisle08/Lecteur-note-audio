import type { Library } from '../library/db';
import { buildSegments } from '../quiz/segments';
import type { AudioStatus, Chapter } from '../types';
import { renderChapterToMp3, type RenderDeps } from './audio';
import type { TtsEngine } from './engine';

export type GeneratorEvent = {
  noteId: string;
  chapterId: string;
  ratio: number;
  status: AudioStatus;
  message?: string;
};

export const QUOTA_MESSAGE = 'Espace insuffisant sur l’appareil';
export const CHAPTER_ERROR_MESSAGE = 'La génération de ce chapitre a échoué.';

function isQuota(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'QuotaExceededError';
}

export class Generator {
  private listeners = new Set<(e: GeneratorEvent) => void>();
  private queued = new Map<string, Promise<void>>();
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private lib: Library,
    private getEngine: (voiceId: string) => Promise<TtsEngine>,
    private renderDeps: RenderDeps = {},
  ) {}

  get busy(): boolean {
    return this.queued.size > 0;
  }

  onProgress(l: (e: GeneratorEvent) => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  generateNote(noteId: string): Promise<void> {
    const existing = this.queued.get(noteId);
    if (existing) return existing;
    const p = this.tail.then(() => this.run(noteId)).finally(() => {
      this.queued.delete(noteId);
    });
    this.tail = p.catch(() => undefined);
    this.queued.set(noteId, p);
    return p;
  }

  async resumeAll(): Promise<void> {
    await this.lib.recoverInterrupted();
    const notes = [];
    for (const course of await this.lib.listCourses()) {
      for (const note of await this.lib.listNotes(course.id)) if (note.status === 'generating') notes.push(note);
    }
    notes.sort((a, b) => a.createdAt - b.createdAt);
    await Promise.all(notes.map((n) => this.generateNote(n.id)));
  }

  private emit(e: GeneratorEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private async run(noteId: string): Promise<void> {
    const lib = this.lib;
    const note = await lib.getNote(noteId);
    if (!note) return;

    // Chapitres exclus supprimés, index recalculés 0..n-1.
    let chapters = await lib.listChapters(noteId);
    for (const ch of chapters) if (!ch.included) await lib.deleteChapter(ch.id);
    chapters = chapters.filter((c) => c.included);
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].index !== i) chapters[i] = await lib.saveChapter({ ...chapters[i], index: i });
    }

    await lib.saveNote({ ...(await lib.getNote(noteId))!, status: 'generating' });

    const todo = chapters.filter((c) => c.audioStatus !== 'ready');
    if (todo.length > 0) {
      const settings = await lib.getSettings();
      let engine: TtsEngine;
      try {
        engine = await this.getEngine(settings.voiceId);
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : CHAPTER_ERROR_MESSAGE;
        this.emit({ noteId, chapterId: todo[0].id, ratio: 0, status: 'error', message });
        return;
      }
      for (const ch of todo) {
        const outcome = await this.generateChapter(noteId, ch, engine, note.quizMode, settings);
        if (outcome === 'quota') return;
      }
    }

    const final = await lib.listChapters(noteId);
    if (final.every((c) => c.audioStatus === 'ready')) {
      const cur = await lib.getNote(noteId);
      if (cur) await lib.saveNote({ ...cur, status: 'ready' });
    }
  }

  private async generateChapter(
    noteId: string,
    ch: Chapter,
    engine: TtsEngine,
    quizMode: boolean,
    settings: { quizPauseSec: number; readPauseInstruction: boolean },
  ): Promise<'ok' | 'error' | 'quota'> {
    const lib = this.lib;
    let current = await lib.saveChapter({ ...ch, audioStatus: 'generating' });
    this.emit({ noteId, chapterId: ch.id, ratio: 0, status: 'generating' });
    try {
      const segments = buildSegments(
        { title: ch.title, text: ch.text },
        { quizMode, quizPauseSec: settings.quizPauseSec, readPauseInstruction: settings.readPauseInstruction },
      );
      const { blob, durationSec } = await renderChapterToMp3(
        segments,
        engine,
        (ratio) => this.emit({ noteId, chapterId: ch.id, ratio, status: 'generating' }),
        this.renderDeps,
      );
      await lib.putAudio(ch.id, blob);
      // putAudio a mis audioLocal à jour : on repart de la version stockée.
      current = (await lib.listChapters(noteId)).find((c) => c.id === ch.id) ?? current;
      await lib.saveChapter({ ...current, audioStatus: 'ready', durationSec });
      this.emit({ noteId, chapterId: ch.id, ratio: 1, status: 'ready' });
      return 'ok';
    } catch (err) {
      const quota = isQuota(err);
      const message = quota ? QUOTA_MESSAGE : CHAPTER_ERROR_MESSAGE;
      const latest = (await lib.listChapters(noteId)).find((c) => c.id === ch.id) ?? current;
      await lib.saveChapter({ ...latest, audioStatus: 'error' });
      this.emit({ noteId, chapterId: ch.id, ratio: 0, status: 'error', message });
      return quota ? 'quota' : 'error';
    }
  }
}
