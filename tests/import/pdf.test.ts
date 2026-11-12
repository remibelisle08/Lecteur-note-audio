// @vitest-environment node
import { ImportError, importFile } from '../../src/import';
import { pdfToBlocks } from '../../src/import/pdf';
import { makePdf, toArrayBuffer } from '../fixtures/makePdf';

const BODY = 'Les lipides sont des molécules hydrophobes présentes dans toutes les cellules.';

describe('pdfToBlocks', () => {
  it('pdf : lignes avec page, fontSize, yRatio', async () => {
    const pdf = await makePdf([
      {
        lines: [
          { text: 'Les lipides', size: 20, y: 750 },
          { text: BODY, size: 12, y: 700 },
        ],
      },
    ]);
    const r = await pdfToBlocks(toArrayBuffer(pdf));
    expect(r.pageCount).toBe(1);
    expect(r.needsOcr).toBe(false);
    expect(r.blocks).toHaveLength(2);
    const [title, body] = r.blocks;
    expect(title).toMatchObject({ text: 'Les lipides', kind: 'paragraph', page: 1 });
    expect(body).toMatchObject({ text: BODY, kind: 'paragraph', page: 1 });
    expect(title.fontSize!).toBeCloseTo(20, 0);
    expect(body.fontSize!).toBeCloseTo(12, 0);
    expect(title.yRatio!).toBeCloseTo(0.05, 2);
    expect(body.yRatio!).toBeCloseTo(1 - 700 / 792, 2);
  });

  it('pdf : plusieurs pages numérotées à partir de 1, ordre haut → bas', async () => {
    const pdf = await makePdf([
      { lines: [{ text: 'Bas de page un', size: 12, y: 100 }, { text: 'Haut de page un', size: 12, y: 700 }] },
      { lines: [{ text: 'Page deux', size: 12, y: 700 }] },
    ]);
    const r = await pdfToBlocks(toArrayBuffer(pdf));
    expect(r.pageCount).toBe(2);
    expect(r.blocks.map(b => [b.text, b.page])).toEqual([
      ['Haut de page un', 1],
      ['Bas de page un', 1],
      ['Page deux', 2],
    ]);
  });

  it('pdf sans texte → needsOcr', async () => {
    const r = await pdfToBlocks(toArrayBuffer(await makePdf([{ lines: [] }])));
    expect(r).toEqual({ blocks: [], pageCount: 1, needsOcr: true });
  });

  it('pdf avec moins de 50 caractères par page en moyenne → needsOcr', async () => {
    const r = await pdfToBlocks(toArrayBuffer(await makePdf([{ lines: [{ text: 'Figure 1', size: 12, y: 700 }] }, { lines: [] }])));
    expect(r.needsOcr).toBe(true);
  });
});

describe('importFile', () => {
  it('importFile .doc → ImportError unsupported-doc', async () => {
    const err = await importFile(new File([new Uint8Array([0xd0, 0xcf])], 'Vieux_cours.DOC')).catch(e => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.code).toBe('unsupported-doc');
    expect(err.message).toBe('Ce fichier est au format .doc (ancien Word). Réenregistre-le en .docx puis réessaie.');
  });

  it('importFile autre extension → ImportError unsupported-type', async () => {
    await expect(importFile(new File(['x'], 'notes.txt'))).rejects.toMatchObject({
      code: 'unsupported-type',
      message: 'Format non pris en charge. Utilise un fichier PDF ou Word (.docx).',
    });
  });

  it('importFile fichier corrompu → ImportError corrupt', async () => {
    const err = await importFile(new File(['ceci n’est pas un pdf'], 'cours.pdf')).catch(e => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.code).toBe('corrupt');
    expect(err.message).toBe('Ce fichier semble endommagé ou illisible.');
  });

  it('importFile titre = nom de fichier sans extension, « _ » → espace', async () => {
    const pdf = await makePdf([
      {
        lines: [
          { text: 'Les lipides', size: 20, y: 750 },
          { text: BODY, size: 12, y: 700 },
          { text: BODY, size: 12, y: 680 },
        ],
      },
    ]);
    const msgs: [string, number][] = [];
    const r = await importFile(new File([toArrayBuffer(pdf)], 'Chapitre_4__partie_2.PDF'), (m, ratio) => msgs.push([m, ratio]));
    expect(r.title).toBe('Chapitre 4 partie 2');
    expect(r.usedOcr).toBe(false);
    expect(r.quizDetected).toBe(false);
    expect(r.chapters.length).toBeGreaterThan(0);
    expect(r.chapters[0].text).toContain('hydrophobes');
    expect(msgs[0][0]).toBe('Lecture du document…');
  });
});
