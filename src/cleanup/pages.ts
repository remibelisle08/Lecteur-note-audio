import type { RawBlock } from '../types';

const EDGE = 0.1;
const MIN_PAGES = 3;
const MIN_SHARE = 0.5;

// Les titres (kind 'heading') ne sont jamais des en-têtes/pieds : un titre de diapo répété reste.
const inEdgeZone = (b: RawBlock): boolean =>
  b.kind !== 'heading' &&
  b.yRatio !== undefined && (b.yRatio < EDGE || b.yRatio > 1 - EDGE);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const headerFooterKey = (text: string): string => normalize(text).replace(/\d+/g, '#');

/** Retire les lignes répétées dans les 10 % haut/bas sur ≥ 50 % des pages (≥ 3 pages). */
export function removeHeadersFooters(blocks: RawBlock[]): RawBlock[] {
  const pages = new Set<number>();
  for (const b of blocks) if (b.page !== undefined) pages.add(b.page);
  if (pages.size < MIN_PAGES) return blocks;

  const pagesByKey = new Map<string, Set<number>>();
  for (const b of blocks) {
    if (b.page === undefined || !inEdgeZone(b)) continue;
    const key = headerFooterKey(b.text);
    if (!key) continue;
    let set = pagesByKey.get(key);
    if (!set) pagesByKey.set(key, (set = new Set()));
    set.add(b.page);
  }
  const repeated = new Set<string>();
  for (const [key, set] of pagesByKey) {
    if (set.size >= pages.size * MIN_SHARE) repeated.add(key);
  }
  return blocks.filter(
    b => b.page === undefined || !inEdgeZone(b) || !repeated.has(headerFooterKey(b.text)),
  );
}

/** Retire la page N si son texte normalisé est contenu dans celui de la page N+1. */
export function dedupeProgressiveSlides(blocks: RawBlock[]): RawBlock[] {
  const textByPage = new Map<number, string[]>();
  for (const b of blocks) {
    if (b.page === undefined) continue;
    const list = textByPage.get(b.page);
    if (list) list.push(b.text);
    else textByPage.set(b.page, [b.text]);
  }
  const pages = [...textByPage.keys()].sort((a, c) => a - c);
  const norm = new Map<number, string>(
    pages.map(p => [p, normalize(textByPage.get(p)!.join(' '))]),
  );

  const dropped = new Set<number>();
  for (let i = 0; i + 1 < pages.length; i++) {
    const current = norm.get(pages[i])!;
    if (!current) continue;
    // Délimiteurs d'espaces : contenance par mots entiers.
    if ((' ' + norm.get(pages[i + 1])! + ' ').includes(' ' + current + ' ')) dropped.add(pages[i]);
  }
  return blocks.filter(b => b.page === undefined || !dropped.has(b.page));
}
