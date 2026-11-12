import { PDFDocument, StandardFonts } from 'pdf-lib';

export type FixtureLine = { text: string; size: number; y: number };

/** PDF de test (612 × 792 pt, Helvetica) : une ligne de texte par entrée, y = ligne de base. */
export async function makePdf(pages: { lines: FixtureLine[] }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const p of pages) {
    const page = doc.addPage([612, 792]);
    for (const l of p.lines) page.drawText(l.text, { x: 50, y: l.y, size: l.size, font });
  }
  return doc.save();
}

/** Copie dans un ArrayBuffer autonome (pdf.js détache parfois le tampon reçu). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
