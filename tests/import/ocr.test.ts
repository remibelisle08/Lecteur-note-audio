// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ocrLinesToBlocks, ocrPdf } from '../../src/import/ocr';
import { makePdf, toArrayBuffer } from '../fixtures/makePdf';

describe('ocrLinesToBlocks', () => {
  it('ocrLinesToBlocks : hauteur de bbox → fontSize, y → yRatio, confiance conservée', () => {
    const blocks = ocrLinesToBlocks(
      [
        { text: 'Les lipides\n', confidence: 91.5, bbox: { y0: 110, y1: 150 } },
        { text: '   ', confidence: 10, bbox: { y0: 300, y1: 320 } },
        { text: 'Corps du texte', confidence: 64, bbox: { y0: 1100, y1: 1124 } },
      ],
      3,
      2200,
    );
    expect(blocks).toEqual([
      { text: 'Les lipides', kind: 'paragraph', page: 3, fontSize: 40, yRatio: 0.05, confidence: 91.5 },
      { text: 'Corps du texte', kind: 'paragraph', page: 3, fontSize: 24, yRatio: 0.5, confidence: 64 },
    ]);
  });
});

describe('ocrPdf', () => {
  it.skipIf(!process.env.OCR_IT)(
    'OCR réel sur une page rendue (intégration, opt-in)',
    async () => {
      // Le PDF a du texte, mais ocrPdf ne regarde que l'image rendue de la page.
      const pdf = await makePdf([
        {
          lines: [
            { text: 'Les lipides', size: 32, y: 700 },
            { text: 'Les molecules hydrophobes de la cellule', size: 18, y: 640 },
          ],
        },
      ]);
      const progress: [number, number][] = [];
      const langPath = fileURLToPath(new URL('../../node_modules/@tesseract.js-data/fra/4.0.0_best_int', import.meta.url));
      const r = await ocrPdf(toArrayBuffer(pdf), (p, t) => progress.push([p, t]), { langPath });
      expect(progress).toEqual([[1, 1]]);
      const text = r.blocks.map(b => b.text).join('\n');
      expect(text).toMatch(/lipides/i);
      expect(text).toMatch(/hydrophobes/i);
      expect(r.blocks.every(b => b.page === 1 && b.kind === 'paragraph')).toBe(true);
      expect(r.meanConfidence).toBeGreaterThan(70);
    },
    120_000,
  );
});
