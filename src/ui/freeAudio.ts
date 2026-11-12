import type { Library } from '../library/db';

/**
 * Supprime de l'appareil l'audio des chapitres déjà écoutés qui ont une copie sur Drive
 * (ils restent écoutables : le lecteur les retélécharge au besoin). Renvoie le nombre de chapitres libérés.
 */
export async function freeListenedAudio(lib: Library): Promise<number> {
  let freed = 0;
  for (const course of await lib.listCourses()) {
    for (const note of await lib.listNotes(course.id)) {
      const done = new Set((await lib.getProgress(note.id))?.completedChapterIds ?? []);
      if (done.size === 0) continue;
      for (const ch of await lib.listChapters(note.id)) {
        if (done.has(ch.id) && ch.audioLocal && ch.audioDriveId) {
          await lib.deleteAudio(ch.id);
          freed++;
        }
      }
    }
  }
  return freed;
}

export const freedMessage = (n: number) =>
  n === 0 ? 'Aucun audio à libérer pour l’instant.' : `Audio libéré pour ${n} chapitre${n > 1 ? 's' : ''}.`;
