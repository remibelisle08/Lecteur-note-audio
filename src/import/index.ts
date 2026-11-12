import { cleanDocument } from '../cleanup';
import { detectQuiz } from '../quiz/segments';
import type { ChapterFlag, DraftChapter, RawBlock } from '../types';
import { docxToBlocks } from './docx';
import { ocrPdf } from './ocr';
import { pdfToBlocks } from './pdf';

export type ImportResult = { title: string; chapters: DraftChapter[]; usedOcr: boolean; quizDetected: boolean };
export type ImportErrorCode = 'unsupported-doc' | 'unsupported-type' | 'corrupt' | 'no-text';

const MESSAGES: Record<ImportErrorCode, string> = {
  'unsupported-doc': 'Ce fichier est au format .doc (ancien Word). Réenregistre-le en .docx puis réessaie.',
  'unsupported-type': 'Format non pris en charge. Utilise un fichier PDF ou Word (.docx).',
  corrupt: 'Ce fichier semble endommagé ou illisible.',
  'no-text': 'Aucun texte n’a pu être lu dans ce PDF.',
};

/** Seuil de confiance OCR moyenne sous lequel les chapitres sont signalés. */
const LOW_CONFIDENCE = 70;

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, options?: { cause?: unknown }) {
    super(MESSAGES[code], options);
    this.name = 'ImportError';
    this.code = code;
  }
}

function titleFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function addFlag(c: DraftChapter, flag: ChapterFlag): DraftChapter {
  return c.flags.includes(flag) ? c : { ...c, flags: [...c.flags, flag] };
}

/** `Blob.arrayBuffer` quand il existe (navigateurs, Node), sinon FileReader (jsdom). */
function readFile(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function parse<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    throw e instanceof ImportError ? e : new ImportError('corrupt', { cause: e });
  }
}

/** Fichier déposé → chapitres nettoyés, prêts à relire. */
export async function importFile(
  file: File,
  onProgress?: (msg: string, ratio: number) => void,
  opts: { forceOcr?: boolean } = {},
): Promise<ImportResult> {
  const ext = extensionOf(file.name);
  if (ext === 'doc') throw new ImportError('unsupported-doc');
  if (ext !== 'pdf' && ext !== 'docx') throw new ImportError('unsupported-type');

  onProgress?.('Lecture du document…', 0);
  const data = await readFile(file);
  let chapters: DraftChapter[];
  let usedOcr = false;

  if (ext === 'docx') {
    const blocks = await parse(() => docxToBlocks(data));
    chapters = cleanDocument(blocks, 'docx');
  } else {
    const text = await parse(() => pdfToBlocks(data));
    let blocks: RawBlock[] = text.blocks;
    let lowConfidence = false;
    if (text.needsOcr || opts.forceOcr) {
      usedOcr = true;
      // Le PDF s'est déjà ouvert : une erreur ici vient de l'OCR (réseau, worker), pas du fichier.
      const ocr = await ocrPdf(data, (page, total) =>
        onProgress?.(`Reconnaissance du texte : page ${page}/${total}`, page / total),
      );
      if (ocr.blocks.length === 0) throw new ImportError('no-text');
      blocks = ocr.blocks;
      lowConfidence = ocr.meanConfidence < LOW_CONFIDENCE;
    }
    chapters = cleanDocument(blocks, 'pdf');
    if (usedOcr && chapters.length === 0) throw new ImportError('no-text');
    if (lowConfidence) chapters = chapters.map(c => addFlag(c, 'ocr-low-confidence'));
  }

  chapters = chapters.map(c => (detectQuiz(c.text) ? addFlag(c, 'has-quiz') : c));
  onProgress?.('Lecture du document…', 1);
  return {
    title: titleFromName(file.name),
    chapters,
    usedOcr,
    quizDetected: chapters.some(c => c.flags.includes('has-quiz')),
  };
}
