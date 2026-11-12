import type { ImportResult } from '../import';
import { newId, type Library } from '../library/db';
import type { Chapter, DraftChapter, Note } from '../types';

export const OCR_FAILED = 'La reconnaissance du texte a échoué. Vérifie ta connexion et réessaie.';
export const NO_CHAPTERS = 'Aucun texte exploitable n’a été trouvé dans ce fichier.';
export const OCR_TIP = 'Astuce : pour un meilleur résultat, utilise “Enregistrer sous → PDF” plutôt que “Imprimer en PDF”.';
export const DEFAULT_COURSE_NAME = 'Mes notes';

/**
 * Erreur levée par importFile → message français. Une ImportError porte déjà le sien ;
 * toute autre erreur vient de l'OCR (CDN, worker) une fois le fichier ouvert.
 * (Pas d'`instanceof` : le module d'import est chargé à la demande.)
 */
export function importErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === 'ImportError' && err.message) return err.message;
  return OCR_FAILED;
}

function toChapters(noteId: string, drafts: DraftChapter[]): Chapter[] {
  const now = Date.now();
  return drafts.map((d, index) => ({
    id: newId(),
    noteId,
    index,
    title: d.title,
    text: d.text,
    included: true,
    flags: [...d.flags],
    audioStatus: 'pending',
    audioLocal: false,
    updatedAt: now,
  }));
}

/** Enregistre un import comme note brouillon (chapitres « pending », tous inclus). */
export async function saveDraft(lib: Library, courseId: string, fileName: string, result: ImportResult): Promise<Note> {
  const order = (await lib.listNotes(courseId)).length;
  const now = Date.now();
  const note = await lib.saveNote({
    id: newId(),
    courseId,
    title: result.title || fileName,
    sourceFileName: fileName,
    order,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    quizMode: result.quizDetected,
    usedOcr: result.usedOcr,
  });
  for (const ch of toChapters(note.id, result.chapters)) await lib.saveChapter(ch);
  return note;
}

/** Remplace les chapitres d'un brouillon par ceux d'un nouvel import. */
export async function replaceDraftChapters(lib: Library, note: Note, result: ImportResult): Promise<Chapter[]> {
  for (const ch of await lib.listChapters(note.id)) await lib.deleteChapter(ch.id);
  const chapters = toChapters(note.id, result.chapters);
  for (const ch of chapters) await lib.saveChapter(ch);
  await lib.saveNote({ ...note, usedOcr: result.usedOcr, quizMode: result.quizDetected || note.quizMode });
  return lib.listChapters(note.id);
}
