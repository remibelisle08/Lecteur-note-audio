import mammoth from 'mammoth';
import { docxToBlocks } from '../../src/import/docx';
import { importFile } from '../../src/import';
import { makeDocx } from '../fixtures/makeDocx';

describe('docxToBlocks', () => {
  it('docx : titres h1/h2 et paragraphes', async () => {
    const b = await docxToBlocks(await makeDocx([{ heading: 1, text: 'Épisode 1' }, { text: 'Bonjour !' }]));
    expect(b).toEqual([{ text: 'Épisode 1', kind: 'heading', level: 1 }, { text: 'Bonjour !', kind: 'paragraph' }]);
  });

  it('docx : h2 → level 2, paragraphes vides ignorés', async () => {
    const b = await docxToBlocks(
      await makeDocx([{ heading: 2, text: 'Partie A' }, { text: '   ' }, { text: 'Texte.' }]),
    );
    expect(b).toEqual([{ text: 'Partie A', kind: 'heading', level: 2 }, { text: 'Texte.', kind: 'paragraph' }]);
  });

  it('docx avec image : texte conservé, image non encodée en base64', async () => {
    const convert = vi.spyOn(mammoth, 'convertToHtml');
    const data = await makeDocx([{ heading: 1, text: 'Schéma' }, { text: 'La cellule ci-dessus.', image: true }]);
    const b = await docxToBlocks(data);
    expect(b).toEqual([{ text: 'Schéma', kind: 'heading', level: 1 }, { text: 'La cellule ci-dessus.', kind: 'paragraph' }]);
    expect(convert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ convertImage: expect.anything() }));
    const { value: html } = await convert.mock.results[0].value;
    expect(html).toContain('<img');
    expect(html).not.toContain('base64');
    convert.mockRestore();
  });
});

describe('importFile (docx)', () => {
  it('docx → chapitres, quiz détecté et flag has-quiz', async () => {
    const data = await makeDocx([
      { heading: 1, text: 'Épisode 1' },
      { text: 'Les lipides sont des molécules.' },
      { heading: 1, text: 'Épisode 2' },
      { text: 'À toi : cite deux lipides ?' },
      { text: 'Mets sur pause.' },
      { text: 'Les triglycérides et les phospholipides.' },
    ]);
    const file = new File([data], 'Podcast_chapitre_4.DOCX');
    const r = await importFile(file);
    expect(r.title).toBe('Podcast chapitre 4');
    expect(r.usedOcr).toBe(false);
    expect(r.quizDetected).toBe(true);
    expect(r.chapters.map(c => c.title)).toEqual(['Épisode 1', 'Épisode 2']);
    expect(r.chapters[0].flags).not.toContain('has-quiz');
    expect(r.chapters[1].flags).toEqual(['has-quiz']);
  });

  it('docx corrompu → ImportError corrupt', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'cours.docx');
    await expect(importFile(file)).rejects.toMatchObject({
      name: 'ImportError',
      code: 'corrupt',
      message: 'Ce fichier semble endommagé ou illisible.',
    });
  });
});
