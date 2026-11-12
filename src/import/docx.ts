import mammoth from 'mammoth';
import type { RawBlock } from '../types';

const HEADINGS: Record<string, number> = { H1: 1, H2: 2, H3: 3 };
const BULLET = /^[•·▪◦‣-]\s*/;

function ownText(el: Element): string {
  // Pour un <li>, ignorer les sous-listes (elles produisent leurs propres blocs).
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 1 && /^(UL|OL)$/.test((node as Element).tagName)) continue;
    text += node.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Convertit un .docx en blocs : h1–h3 → titres, p/li → paragraphes. */
export async function docxToBlocks(data: ArrayBuffer): Promise<RawBlock[]> {
  // `arrayBuffer` : build navigateur de mammoth ; `buffer` : build Node (Vitest). JSZip accepte les deux.
  const input = { arrayBuffer: data, buffer: data } as unknown as { arrayBuffer: ArrayBuffer };
  const { value: html } = await mammoth.convertToHtml(input);
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: RawBlock[] = [];
  for (const el of Array.from(dom.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li'))) {
    const level = HEADINGS[el.tagName];
    if (el.tagName === 'LI') {
      const text = ownText(el).replace(BULLET, '').trim();
      if (text) blocks.push({ text, kind: 'paragraph' });
    } else if (el.tagName === 'P' && el.closest('li')) {
      continue; // déjà compté dans le <li>
    } else {
      const text = ownText(el);
      if (!text) continue;
      blocks.push(level ? { text, kind: 'heading', level } : { text, kind: 'paragraph' });
    }
  }
  return blocks;
}
