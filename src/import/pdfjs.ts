/**
 * Chargeur unique de pdf.js.
 * - Application (navigateur) : build standard, worker servi par Vite via `?url`.
 * - Vitest (Node) : build `legacy`, sans worker explicite (pdf.js bascule sur son
 *   « fake worker » dans Node). `import.meta.env.MODE` est remplacé à la compilation,
 *   donc la branche de test disparaît du bundle de production.
 */
type PdfjsModule = typeof import('pdfjs-dist');

let loading: Promise<PdfjsModule> | undefined;

export function getPdfjs(): Promise<PdfjsModule> {
  loading ??= load();
  return loading;
}

async function load(): Promise<PdfjsModule> {
  if (import.meta.env.MODE === 'test') {
    return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;
  }
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
}

/** Ouvre un PDF ; pdf.js peut détacher le tampon reçu, on lui passe une copie. */
export async function openPdf(data: ArrayBuffer) {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    return await task.promise;
  } catch (e) {
    await task.destroy(); // fichier illisible : libérer le worker
    throw e;
  }
}
