import { useCallback } from 'react';
import { useApp } from '../AppContext';
import { navigate } from '../routes';

export const OPEN_NOTE_ERROR = 'Impossible d’ouvrir cette note. Réessaie.';
export const OPEN_COURSE_ERROR = 'Impossible d’ouvrir ce cours. Réessaie.';

/** Charge une note ou un cours dans le lecteur, lance la lecture et ouvre l'écran du lecteur. */
export function useListen() {
  const { player, notify } = useApp();
  return useCallback(
    async (target: { noteId: string } | { courseId: string }) => {
      try {
        if ('noteId' in target) await player.loadNote(target.noteId);
        else await player.loadCourse(target.courseId);
      } catch {
        notify('noteId' in target ? OPEN_NOTE_ERROR : OPEN_COURSE_ERROR);
        return;
      }
      navigate({ name: 'player' });
      player.play().catch(() => undefined);
    },
    [player, notify],
  );
}
