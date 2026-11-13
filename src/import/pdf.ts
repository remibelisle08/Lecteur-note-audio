import type { RawBlock } from '../types';
import { openPdf } from './pdfjs';

/** Seuil : moyenne de caractères extraits par page en dessous de laquelle on passe à l'OCR. */
const MIN_CHARS_PER_PAGE = 50;
/** Tolérance (pt) pour regrouper des fragments sur une même ligne de base. */
const LINE_TOLERANCE = 2;

type Fragment = { str: string; x: number; y: number; width: number; height: number };
type Line = { y: number; frags: Fragment[] };

function lineText(frags: Fragment[]): string {
  const sorted = [...frags].sort((a, b) => a.x - b.x);
  let out = '';
  let prevEnd = -Infinity;
  for (const f of sorted) {
    const gap = f.x - prevEnd;
    const needsSpace =
      out.length > 0 && gap > Math.max(1, f.height * 0.15) && !/\s$/.test(out) && !/^\s/.test(f.str);
    out += (needsSpace ? ' ' : '') + f.str;
    prevEnd = f.x + f.width;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Extrait le texte d'un PDF : un bloc par ligne, avec page, taille de police et position verticale. */
export async function pdfToBlocks(
  data: ArrayBuffer,
): Promise<{ blocks: RawBlock[]; pageCount: number; needsOcr: boolean }> {
  const doc = await openPdf(data);
  try {
    const blocks: RawBlock[] = [];
    let totalChars = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const lines: Line[] = [];
      for (const item of content.items) {
        if (!('str' in item) || item.str.length === 0) continue;
        const t = item.transform as number[];
        const frag: Fragment = {
          str: item.str,
          x: t[4],
          y: t[5],
          width: item.width,
          height: item.height || Math.hypot(t[2], t[3]),
        };
        const line = lines.find(l => Math.abs(l.y - frag.y) <= LINE_TOLERANCE);
        if (line) line.frags.push(frag);
        else lines.push({ y: frag.y, frags: [frag] });
      }
      lines.sort((a, b) => b.y - a.y);
      for (const l of lines) {
        const text = lineText(l.frags);
        if (!text) continue;
        totalChars += text.length;
        const fontSize = Math.max(...l.frags.map(f => f.height));
        const yRatio = Math.min(1, Math.max(0, 1 - l.y / viewport.height));
        blocks.push({ text, kind: 'paragraph', page: p, fontSize, yRatio });
      }
      page.cleanup();
    }
    const pageCount = doc.numPages;
    return { blocks, pageCount, needsOcr: totalChars / pageCount < MIN_CHARS_PER_PAGE };
  } finally {
    await doc.loadingTask.destroy(); // pdf.js 6 : la destruction passe par la tâche de chargement
  }
}
