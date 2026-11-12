import type { GeneratorEvent } from '../tts/generator';
import type { AudioStatus, Chapter } from '../types';

export type NoteGeneration = {
  /** Dernier évènement reçu par chapitre. */
  chapters: Record<string, { status: AudioStatus; ratio: number }>;
  /** Dernier message d'erreur (effacé quand la génération est relancée). */
  error?: string;
};

const EMPTY: NoteGeneration = { chapters: {} };

/** Mémorise les évènements du générateur par note, pour l'affichage (« Génération… 40 % »). */
export class GenerationStore {
  private notes = new Map<string, NoteGeneration>();
  private listeners = new Set<() => void>();

  constructor(onProgress: (l: (e: GeneratorEvent) => void) => () => void) {
    onProgress((e) => this.record(e));
  }

  private record(e: GeneratorEvent) {
    const prev = this.notes.get(e.noteId) ?? EMPTY;
    this.notes.set(e.noteId, {
      chapters: { ...prev.chapters, [e.chapterId]: { status: e.status, ratio: e.ratio } },
      error: e.status === 'error' ? (e.message ?? prev.error) : prev.error,
    });
    this.listeners.forEach((l) => l());
  }

  clearError(noteId: string) {
    const prev = this.notes.get(noteId);
    if (!prev?.error) return;
    this.notes.set(noteId, { ...prev, error: undefined });
    this.listeners.forEach((l) => l());
  }

  get(noteId: string): NoteGeneration {
    return this.notes.get(noteId) ?? EMPTY;
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
}

/** Avancement global (0–1) d'une note sur ses chapitres inclus : évènements en direct, sinon état en base. */
export function noteRatio(chapters: Chapter[], gen: NoteGeneration): number {
  const included = chapters.filter((c) => c.included);
  if (included.length === 0) return 0;
  let sum = 0;
  for (const ch of included) {
    const live = gen.chapters[ch.id];
    const status = live?.status ?? ch.audioStatus;
    if (status === 'ready' || ch.audioStatus === 'ready') sum += 1;
    else if (status === 'generating') sum += live?.ratio ?? 0;
  }
  return sum / included.length;
}
