import { useCallback, useSyncExternalStore } from 'react';
import { useApp } from '../AppContext';
import type { NoteGeneration } from '../generationStore';

/** Évènements de génération en direct pour une note. */
export function useGeneration(noteId: string): NoteGeneration {
  const { generation } = useApp();
  const get = useCallback(() => generation.get(noteId), [generation, noteId]);
  return useSyncExternalStore(generation.subscribe, get);
}
