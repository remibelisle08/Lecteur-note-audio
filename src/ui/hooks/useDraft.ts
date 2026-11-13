import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportResult } from '../../import';
import type { Chapter, Note } from '../../types';
import { useApp } from '../AppContext';
import { replaceDraftChapters } from '../drafts';

const SAVE_DELAY_MS = 500;
export const SAVE_ERROR = 'Impossible d’enregistrer tes modifications. Réessaie.';

type Work = () => Promise<unknown>;

/**
 * Brouillon en cours de relecture : l'état local fait foi, chaque modification est enregistrée
 * dans la bibliothèque après ~500 ms (`flush()` force l'écriture, aussi faite au démontage).
 */
export function useDraft(noteId: string) {
  const { lib, notify } = useApp();
  const [note, setNoteState] = useState<Note | null>();
  const [chapters, setChaptersState] = useState<Chapter[]>([]);
  const noteRef = useRef<Note | null>();
  const chaptersRef = useRef<Chapter[]>([]);
  const pending = useRef(new Map<string, { work: Work; timer: ReturnType<typeof setTimeout> }>());

  const setNote = (n: Note | null) => {
    noteRef.current = n;
    setNoteState(n);
  };
  const setChapters = (c: Chapter[]) => {
    chaptersRef.current = c;
    setChaptersState(c);
  };

  const run = useCallback(
    async (key: string) => {
      const p = pending.current.get(key);
      if (!p) return;
      clearTimeout(p.timer);
      pending.current.delete(key);
      try {
        await p.work();
      } catch {
        notify(SAVE_ERROR);
      }
    },
    [notify],
  );

  const schedule = (key: string, work: Work, delay = SAVE_DELAY_MS) => {
    const prev = pending.current.get(key);
    if (prev) clearTimeout(prev.timer);
    pending.current.set(key, { work, timer: setTimeout(() => void run(key), delay) });
  };

  const flush = useCallback(async () => {
    await Promise.all([...pending.current.keys()].map((k) => run(k)));
  }, [run]);

  const cancelChapterSaves = () => {
    for (const [key, p] of pending.current) {
      if (key.startsWith('ch:')) {
        clearTimeout(p.timer);
        pending.current.delete(key);
      }
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const n = await lib.getNote(noteId);
      const chs = n ? await lib.listChapters(noteId) : [];
      if (!alive) return;
      setChapters(chs);
      setNote(n ?? null);
    })().catch(() => {
      if (alive) setNote(null);
    });
    return () => {
      alive = false;
      void flush();
    };
  }, [lib, noteId]);

  const updateNote = (patch: Partial<Note>) => {
    if (!noteRef.current) return;
    setNote({ ...noteRef.current, ...patch });
    schedule('note', () => lib.saveNote(noteRef.current!));
  };

  const updateChapter = (id: string, patch: Partial<Chapter>, immediate = false) => {
    setChapters(chaptersRef.current.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const key = `ch:${id}`;
    schedule(key, async () => {
      const ch = chaptersRef.current.find((c) => c.id === id);
      if (ch) await lib.saveChapter(ch);
    });
    if (immediate) void run(key);
  };

  /** Fusionne le chapitre `i` avec le suivant (titre du suivant gardé dans le texte, en intertitre). */
  const mergeWithNext = async (i: number) => {
    await flush();
    const list = chaptersRef.current;
    const a = list[i];
    const b = list[i + 1];
    if (!a || !b) return;
    // Le titre du suivant devient un intertitre « ## » (pause de section à la lecture).
    const heading = b.title.trim() ? `## ${b.title.trim()}` : '';
    const text = [a.text, heading, b.text].filter((t) => t.trim()).join('\n\n');
    const flags = [...new Set([...(a.flags ?? []), ...(b.flags ?? [])])];
    const rest = list
      .filter((c) => c.id !== b.id)
      .map((c, index) => (c.id === a.id ? { ...a, text, flags, index } : { ...c, index }));
    setChapters(rest);
    try {
      await lib.deleteChapter(b.id);
      for (const c of rest) {
        if (c.id === a.id || c.index !== list.find((o) => o.id === c.id)?.index) await lib.saveChapter(c);
      }
    } catch {
      notify(SAVE_ERROR);
    }
  };

  /** Remplace les chapitres par ceux d'un nouvel import (modifications non enregistrées abandonnées). */
  const replaceChapters = async (result: ImportResult) => {
    cancelChapterSaves();
    await flush();
    if (!noteRef.current) return;
    const chs = await replaceDraftChapters(lib, noteRef.current, result);
    const fresh = await lib.getNote(noteId);
    setChapters(chs);
    if (fresh) setNote(fresh);
  };

  return { note, chapters, updateNote, updateChapter, mergeWithNext, replaceChapters, flush };
}
