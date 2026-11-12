import type { DraftChapter, RawBlock } from '../types';
import { detectChapters, markPdfHeadings } from './chapters';
import {
  dropNoiseBlocks,
  joinLines,
  normalizeWhitespace,
  removePageNumbers,
  stripOcrArtifacts,
} from './normalize';
import { dedupeProgressiveSlides, removeHeadersFooters } from './pages';

export { detectChapters, estimateMinutes } from './chapters';

/** Pipeline complet : blocs bruts → chapitres prêts à relire. */
export function cleanDocument(blocks: RawBlock[], source: 'pdf' | 'docx'): DraftChapter[] {
  let work: RawBlock[];
  if (source === 'pdf') {
    // Titres marqués d'abord : removeHeadersFooters épargne les titres répétés en haut de page.
    work = dedupeProgressiveSlides(removePageNumbers(removeHeadersFooters(markPdfHeadings(blocks))));
    work = work.map(b => (b.kind === 'heading' ? b : { ...b, text: stripOcrArtifacts(b.text) }));
    work = dropNoiseBlocks(work);
    work = joinLines(work);
  } else {
    work = joinLines(blocks);
  }
  return detectChapters(work, source)
    .map(c => ({ ...c, text: normalizeWhitespace(c.text) }))
    .filter(c => c.text.length > 0);
}
