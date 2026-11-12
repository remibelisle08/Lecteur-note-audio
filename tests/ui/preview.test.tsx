import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { chapter, course, fakeGenerator, makeServices, note, openTestLibrary, renderAt, words } from './helpers';

async function setup() {
  const lib = await openTestLibrary();
  await lib.saveCourse(course('c1', 'Biologie'));
  await lib.saveNote(note('n1', 'c1', { title: 'Cellule' }));
  await lib.saveChapter(chapter('a', 'n1', 0, { title: 'Introduction', text: words(150, 'alpha') }));
  await lib.saveChapter(chapter('b', 'n1', 1, { title: 'Membrane', text: words(150, 'beta'), flags: ['has-quiz'] }));
  await lib.saveChapter(chapter('c', 'n1', 2, { title: 'Noyau', text: words(150, 'gamma') }));
  return lib;
}

const articles = () => screen.getAllByRole('article');

describe('PreviewScreen', () => {
  it("décocher un chapitre puis « Générer l'audio » : generateNote appelé, chapitre exclu en base", async () => {
    const lib = await setup();
    const generator = fakeGenerator();
    renderAt('#/preview/n1', makeServices(lib, { generator }));
    await screen.findByDisplayValue('Membrane');

    fireEvent.click(within(articles()[1]).getByRole('checkbox', { name: 'Inclure' }));
    fireEvent.click(screen.getByRole('button', { name: "Générer l'audio" }));

    await waitFor(() => expect(generator.generateNote).toHaveBeenCalledWith('n1'));
    const chapters = await lib.listChapters('n1');
    expect(chapters.find((c) => c.id === 'b')?.included).toBe(false);
    expect(chapters.find((c) => c.id === 'a')?.included).toBe(true);
  });

  it('fusionner avec le suivant concatène les textes et supprime le chapitre suivant', async () => {
    const lib = await setup();
    renderAt('#/preview/n1', makeServices(lib));
    await screen.findByDisplayValue('Membrane');

    fireEvent.click(within(articles()[0]).getByRole('button', { name: 'Fusionner avec le suivant' }));

    await waitFor(() => expect(articles()).toHaveLength(2));
    const text = within(articles()[0]).getByLabelText('Texte du chapitre') as HTMLTextAreaElement;
    expect(text.value).toBe(`${words(150, 'alpha')}\n\n## Membrane\n\n${words(150, 'beta')}`);
    await waitFor(async () => {
      const chapters = await lib.listChapters('n1');
      expect(chapters.map((c) => [c.id, c.index])).toEqual([['a', 0], ['c', 1]]);
      expect(chapters[0].text).toContain('beta');
      expect(chapters[0].flags).toEqual(['has-quiz']);
    });
  });

  it('la durée estimée se met à jour', async () => {
    const lib = await setup();
    renderAt('#/preview/n1', makeServices(lib));
    await screen.findByText('≈ 3 min');

    fireEvent.click(within(articles()[2]).getByRole('checkbox', { name: 'Inclure' }));
    expect(screen.getByText('≈ 2 min')).toBeInTheDocument();

    fireEvent.change(within(articles()[0]).getByLabelText('Texte du chapitre'), { target: { value: words(450) } });
    expect(screen.getByText('≈ 4 min')).toBeInTheDocument();
  });

  it('affiche les icônes de flags et le mode quiz pré-coché si détecté', async () => {
    const lib = await setup();
    await lib.saveNote(note('n1', 'c1', { title: 'Cellule', quizMode: true }));
    renderAt('#/preview/n1', makeServices(lib));
    await screen.findByDisplayValue('Membrane');
    expect(within(articles()[1]).getByRole('img', { name: 'Contient un quiz' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Mode quiz' })).toBeChecked();
    expect(screen.getByText("Garde l'app ouverte pendant la génération.")).toBeInTheDocument();
  });

  it('le titre de la note est modifiable et enregistré', async () => {
    const lib = await setup();
    renderAt('#/preview/n1', makeServices(lib));
    fireEvent.change(await screen.findByLabelText('Titre de la note'), { target: { value: 'La cellule' } });
    await waitFor(async () => expect((await lib.getNote('n1'))?.title).toBe('La cellule'), { timeout: 2000 });
  });

  it('lien OCR visible seulement pour un PDF gardé en mémoire ; relance avec forceOcr et remplace les chapitres', async () => {
    const lib = await setup();
    const sourceFiles = new Map<string, File>();
    const { unmount } = renderAt('#/preview/n1', makeServices(lib, { sourceFiles }));
    await screen.findByDisplayValue('Membrane');
    expect(screen.queryByRole('button', { name: /Réessayer avec la reconnaissance de texte/ })).toBeNull();
    unmount();

    const file = new File(['x'], 'cellule.pdf', { type: 'application/pdf' });
    sourceFiles.set('n1', file);
    const importFile = vi.fn(async () => ({
      title: 'cellule', usedOcr: true, quizDetected: false,
      chapters: [{ title: 'Texte reconnu', text: words(20, 'ocr'), included: true, flags: ['ocr-low-confidence' as const] }],
    }));
    renderAt('#/preview/n1', makeServices(lib, { sourceFiles, importFile }));
    fireEvent.click(await screen.findByRole('button', { name: /Réessayer avec la reconnaissance de texte/ }));

    await screen.findByDisplayValue('Texte reconnu');
    expect(importFile).toHaveBeenCalledWith(file, expect.any(Function), { forceOcr: true });
    expect(articles()).toHaveLength(1);
    expect(within(articles()[0]).getByRole('img', { name: 'Reconnaissance de texte peu fiable' })).toBeInTheDocument();
    const chapters = await lib.listChapters('n1');
    expect(chapters.map((c) => c.title)).toEqual(['Texte reconnu']);
    expect((await lib.getNote('n1'))?.usedOcr).toBe(true);
  });

  it('OCR réussi mais enregistrement impossible : message d’enregistrement, pas d’erreur de reconnaissance', async () => {
    const lib = await setup();
    const sourceFiles = new Map([['n1', new File(['x'], 'cellule.pdf')]]);
    const importFile = vi.fn(async () => ({
      title: 'cellule', usedOcr: true, quizDetected: false,
      chapters: [{ title: 'Texte reconnu', text: words(20, 'ocr'), included: true, flags: [] }],
    }));
    renderAt('#/preview/n1', makeServices({ ...lib, deleteChapter: async () => { throw new Error('idb'); } }, { sourceFiles, importFile }));
    fireEvent.click(await screen.findByRole('button', { name: /Réessayer avec la reconnaissance de texte/ }));
    expect(await screen.findByText('Impossible d’enregistrer tes modifications. Réessaie.')).toBeInTheDocument();
    expect(screen.queryByText(/La reconnaissance du texte a échoué/)).toBeNull();
  });
});
