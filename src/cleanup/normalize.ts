import type { RawBlock } from '../types';

const SENTENCE_END = /[.!?:]$/;
const HYPHEN_BREAK = /\p{L}-$/u;
const STARTS_LOWER = /^\p{Ll}/u;

/** Recolle les lignes d'un même paragraphe et les césures de fin de ligne. */
export function joinLines(blocks: RawBlock[]): RawBlock[] {
  const out: RawBlock[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    const mergeable =
      prev &&
      prev.kind !== 'heading' &&
      block.kind !== 'heading' &&
      prev.page === block.page;
    if (mergeable) {
      const prevText = prev.text.trimEnd();
      if (HYPHEN_BREAK.test(prevText) && STARTS_LOWER.test(block.text)) {
        prev.text = prevText.slice(0, -1) + block.text;
        continue;
      }
      if (!SENTENCE_END.test(prevText)) {
        prev.text = prevText + ' ' + block.text;
        continue;
      }
    }
    out.push({ ...block });
  }
  return out;
}

const PAGE_NUMBER_PATTERNS = [
  /^[-–—]?\s*\d{1,4}\s*[-–—]?$/,
  /^page\s+\d+(\s*(de|sur|\/)\s*\d+)?$/i,
  /^\d{1,4}\s*\/\s*\d{1,4}$/,
];

/** Retire les blocs qui ne sont qu'un numéro de page. */
export function removePageNumbers(blocks: RawBlock[]): RawBlock[] {
  return blocks.filter(b => {
    const t = b.text.trim();
    return !PAGE_NUMBER_PATTERNS.some(re => re.test(t));
  });
}

const OCR_BULLET =
  /^(?:[Œ©@]|[^\p{L}\p{N}\s«“"‘'])(?:[Œ©@]|[^\p{L}\p{N}\s«“"‘']){0,2}[\p{L}\p{N}]{0,2}[^\p{L}\p{N}\s]{0,3}\s+(?=\p{Lu})/u;

/** Retire les pastilles/icônes mal reconnues en début de paragraphe. */
export function stripOcrArtifacts(text: string): string {
  return text.replace(OCR_BULLET, '');
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Retire les blocs de moins de 3 lettres (bruit OCR, puces, numéros). */
export function dropNoiseBlocks(blocks: RawBlock[]): RawBlock[] {
  return blocks.filter(b => (b.text.match(/\p{L}/gu) ?? []).length >= 3);
}
