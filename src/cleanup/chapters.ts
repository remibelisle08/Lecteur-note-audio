import type { ChapterFlag, DraftChapter, RawBlock } from '../types';

const HEADING_RATIO = 1.2;
const HEADING_MAX_LENGTH = 80;
const PARAGRAPH_LENGTH = 80;
const SPLIT_WORDS = 1500;
const CAPTION_MAX_WORDS = 8;
const WORDS_PER_MINUTE = 150;
const SENTENCE_END = /[.!?:]$/;

const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;
const normalizeTitle = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** PDF : marque comme titres (niveau 1) les blocs nettement plus gros que le corps. */
export function markPdfHeadings(blocks: RawBlock[]): RawBlock[] {
  const sized = blocks.filter(b => b.kind === 'paragraph' && b.fontSize !== undefined);
  const long = sized.filter(b => b.text.length > PARAGRAPH_LENGTH);
  const reference = long.length > 0 ? long : sized;
  if (reference.length === 0) return blocks;
  const bodySize = median(reference.map(b => b.fontSize!));
  return blocks.map(b =>
    b.kind === 'paragraph' &&
    b.fontSize !== undefined &&
    b.fontSize >= HEADING_RATIO * bodySize &&
    b.text.trim().length <= HEADING_MAX_LENGTH
      ? { ...b, kind: 'heading', level: 1 }
      : b,
  );
}

type Item = { heading?: { level: number; text: string }; paragraph?: string };
type Draft = { title: string; items: Item[] };

function toChapter(draft: Draft): DraftChapter {
  const parts: string[] = [];
  const flags: ChapterFlag[] = [];
  const { items } = draft;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.heading) {
      parts.push(`${'#'.repeat(item.heading.level)} ${item.heading.text}`);
      continue;
    }
    const text = item.paragraph!;
    parts.push(text);
    const isCaption =
      i > 0 &&
      i + 1 < items.length &&
      items[i - 1].paragraph !== undefined &&
      items[i + 1].paragraph !== undefined &&
      countWords(text) < CAPTION_MAX_WORDS &&
      !SENTENCE_END.test(text.trim());
    if (isCaption && !flags.includes('has-captions')) flags.push('has-captions');
  }
  return { title: draft.title, text: parts.join('\n\n'), included: true, flags };
}

function splitByWords(blocks: RawBlock[]): DraftChapter[] {
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let words = 0;
  for (const b of blocks) {
    const w = countWords(b.text);
    if (!current || (words > 0 && words + w > SPLIT_WORDS)) {
      current = { title: `Partie ${drafts.length + 1}`, items: [] };
      drafts.push(current);
      words = 0;
    }
    current.items.push({ paragraph: b.text });
    words += w;
  }
  return drafts.map(toChapter);
}

/** Découpe en chapitres : titres (h1 ou plus haut niveau présent) sinon sections de ~1500 mots. */
export function detectChapters(blocks: RawBlock[], source: 'pdf' | 'docx'): DraftChapter[] {
  const input = source === 'pdf' ? markPdfHeadings(blocks) : blocks;
  const headings = input.filter(b => b.kind === 'heading');
  if (headings.length === 0) return splitByWords(input);

  const chapterLevel = Math.min(...headings.map(b => b.level ?? 1));
  const drafts: Draft[] = [];
  let current: Draft | null = null;

  for (const b of input) {
    if (b.kind === 'heading') {
      const level = b.level ?? 1;
      if (level <= chapterLevel) {
        if (current && normalizeTitle(current.title) === normalizeTitle(b.text)) continue;
        current = { title: b.text.trim(), items: [] };
        drafts.push(current);
      } else {
        if (!current) {
          current = { title: 'Introduction', items: [] };
          drafts.push(current);
        }
        current.items.push({ heading: { level, text: b.text.trim() } });
      }
      continue;
    }
    if (!current) {
      current = { title: 'Introduction', items: [] };
      drafts.push(current);
    }
    current.items.push({ paragraph: b.text });
  }
  return drafts.map(toChapter);
}

export function estimateMinutes(text: string): number {
  const words = countWords(text);
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
