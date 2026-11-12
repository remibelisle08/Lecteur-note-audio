import type { RawBlock } from '../types';
import { openPdf } from './pdfjs';

/** Rendu à 200 dpi (pdf.js travaille en points, 72 par pouce). */
const OCR_SCALE = 200 / 72;

export type OcrLine = { text: string; confidence: number; bbox: { y0: number; y1: number } };

/** Lignes Tesseract → blocs bruts (un par ligne), comme pour un PDF texte. */
export function ocrLinesToBlocks(lines: OcrLine[], page: number, pageHeight: number): RawBlock[] {
  const blocks: RawBlock[] = [];
  for (const l of lines) {
    const text = l.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    blocks.push({
      text,
      kind: 'paragraph',
      page,
      fontSize: l.bbox.y1 - l.bbox.y0,
      yRatio: pageHeight > 0 ? l.bbox.y0 / pageHeight : 0,
      confidence: l.confidence,
    });
  }
  return blocks;
}

type PdfDoc = Awaited<ReturnType<typeof openPdf>>;
type PdfPage = Awaited<ReturnType<PdfDoc['getPage']>>;
type NodeCanvas = { toBuffer(mime: 'image/png'): Uint8Array };
type CanvasFactory = {
  create(w: number, h: number): { canvas: NodeCanvas; context: CanvasRenderingContext2D };
};

/** Rend une page dans une image lisible par Tesseract (canevas navigateur, ou PNG sous Node). */
async function renderPage(doc: PdfDoc, page: PdfPage) {
  const viewport = page.getViewport({ scale: OCR_SCALE });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  if (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined') {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context, viewport }).promise;
    return { image: canvas, height };
  }
  // Node (tests d'intégration) : fabrique de canevas fournie par pdf.js (@napi-rs/canvas).
  const { canvas, context } = (doc.canvasFactory as CanvasFactory).create(width, height);
  await page.render({ canvas: null, canvasContext: context, viewport }).promise;
  return { image: canvas.toBuffer('image/png'), height };
}

/**
 * OCR de toutes les pages d'un PDF (Tesseract, français). Un seul worker est réutilisé,
 * puis terminé. `opts.langPath` permet de fournir les données de langue localement
 * (tests, sans cache) ; sinon Tesseract les télécharge depuis son CDN par défaut.
 */
export async function ocrPdf(
  data: ArrayBuffer,
  onProgress: (page: number, total: number) => void,
  opts: { langPath?: string } = {},
): Promise<{ blocks: RawBlock[]; meanConfidence: number }> {
  const doc = await openPdf(data);
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(
    'fra',
    1,
    // Données locales : inutile de les recopier dans le cache de Tesseract.
    opts.langPath ? { langPath: opts.langPath, cacheMethod: 'none' } : {},
  );
  try {
    const blocks: RawBlock[] = [];
    let confSum = 0;
    let confCount = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { image, height } = await renderPage(doc, page);
      const { data: result } = await worker.recognize(image as Parameters<typeof worker.recognize>[0]);
      const pageBlocks = ocrLinesToBlocks(result.lines, p, height);
      for (const b of pageBlocks) {
        confSum += b.confidence ?? 0;
        confCount++;
      }
      blocks.push(...pageBlocks);
      page.cleanup();
      onProgress(p, doc.numPages);
    }
    return { blocks, meanConfidence: confCount ? confSum / confCount : 0 };
  } finally {
    await worker.terminate();
    await doc.destroy();
  }
}
