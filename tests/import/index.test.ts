// @vitest-environment node
import type { RawBlock } from '../../src/types';

const ocrResult: { blocks: RawBlock[]; meanConfidence: number } = { blocks: [], meanConfidence: 0 };
vi.mock('../../src/import/ocr', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/import/ocr')>()),
  ocrPdf: vi.fn(async (_data: ArrayBuffer, onProgress: (p: number, t: number) => void) => {
    onProgress(1, 2);
    onProgress(2, 2);
    return ocrResult;
  }),
}));

import { importFile } from '../../src/import';
import { makePdf, toArrayBuffer } from '../fixtures/makePdf';

const line = (text: string, y: number, fontSize = 24, page = 1): RawBlock => ({
  text,
  kind: 'paragraph',
  page,
  fontSize,
  yRatio: y,
  confidence: 60,
});

describe('importFile (OCR)', () => {
  it('PDF scanné : OCR, flag ocr-low-confidence (sans doublon) et progression', async () => {
    ocrResult.blocks = [
      line('Les lipides', 0.2, 48),
      line('À toi : qu’est-ce qu’un lipide ?', 0.4),
      line('Mets sur pause.', 0.5),
      line('Une molécule hydrophobe.', 0.6),
    ];
    ocrResult.meanConfidence = 62;
    const msgs: string[] = [];
    const r = await importFile(new File([toArrayBuffer(await makePdf([{ lines: [] }]))], 'Scan.pdf'), m => msgs.push(m));
    expect(r.usedOcr).toBe(true);
    expect(r.quizDetected).toBe(true);
    expect(r.chapters.length).toBeGreaterThan(0);
    for (const c of r.chapters) {
      expect(c.flags.filter(f => f === 'ocr-low-confidence')).toHaveLength(1);
      expect(new Set(c.flags).size).toBe(c.flags.length);
    }
    expect(msgs).toContain('Reconnaissance du texte : page 1/2');
    expect(msgs).toContain('Reconnaissance du texte : page 2/2');
  });

  it('forceOcr sur un PDF texte, confiance ≥ 70 → pas de flag', async () => {
    ocrResult.blocks = [line('Bonjour à tous, voici le cours sur les lipides.', 0.3)];
    ocrResult.meanConfidence = 88;
    const pdf = await makePdf([{ lines: [{ text: 'x'.repeat(120), size: 12, y: 700 }] }]);
    const r = await importFile(new File([toArrayBuffer(pdf)], 'a.pdf'), undefined, { forceOcr: true });
    expect(r.usedOcr).toBe(true);
    expect(r.chapters.every(c => !c.flags.includes('ocr-low-confidence'))).toBe(true);
  });

  it('OCR sans texte → ImportError no-text', async () => {
    ocrResult.blocks = [];
    ocrResult.meanConfidence = 0;
    await expect(importFile(new File([toArrayBuffer(await makePdf([{ lines: [] }]))], 'vide.pdf'))).rejects.toMatchObject({
      code: 'no-text',
      message: 'Aucun texte n’a pu être lu dans ce PDF.',
    });
  });
});
