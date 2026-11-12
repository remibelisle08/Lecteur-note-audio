import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { makeServices, openTestLibrary, renderAt, words } from './helpers';

const pick = (files: File[]) =>
  fireEvent.change(screen.getByLabelText(/Choisir des fichiers/), { target: { files } });

class ImportError extends Error {
  code = 'unsupported-doc';
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

describe('ImportScreen', () => {
  it('erreur non ImportError → message générique ; les autres fichiers continuent', async () => {
    const lib = await openTestLibrary();
    const importFile = vi.fn(async (file: File) => {
      if (file.name === 'a.pdf') throw new TypeError('Failed to fetch');
      if (file.name === 'b.doc') throw new ImportError('Ce fichier est au format .doc (ancien Word). Réenregistre-le en .docx puis réessaie.');
      if (file.name === 'c.pdf') return { title: 'c', chapters: [], usedOcr: false, quizDetected: false };
      return {
        title: 'Notes d', usedOcr: true, quizDetected: false,
        chapters: [{ title: 'Intro', text: words(10), included: true, flags: [] }],
      };
    });
    renderAt('#/import', makeServices(lib, { importFile }));
    expect(screen.getByLabelText(/Choisir des fichiers/)).toHaveAttribute('accept', '.pdf,.docx');

    pick([
      new File(['1'], 'a.pdf'), new File(['2'], 'b.doc'), new File(['3'], 'c.pdf'), new File(['4'], 'd.docx'),
    ]);

    expect(await screen.findByText('La reconnaissance du texte a échoué. Vérifie ta connexion et réessaie.')).toBeInTheDocument();
    expect(await screen.findByText(/Réenregistre-le en .docx/)).toBeInTheDocument();
    expect(await screen.findByText('Aucun texte exploitable n’a été trouvé dans ce fichier.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Relire « Notes d »/ })).toBeInTheDocument();
    expect(screen.getByText(/Astuce : pour un meilleur résultat/)).toBeInTheDocument();

    const courses = await lib.listCourses();
    expect(courses.map((c) => c.name)).toEqual(['Mes notes']);
    const notes = await lib.listNotes(courses[0].id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: 'Notes d', status: 'draft', usedOcr: true, sourceFileName: 'd.docx' });
    const chapters = await lib.listChapters(notes[0].id);
    expect(chapters).toMatchObject([{ title: 'Intro', index: 0, included: true, audioStatus: 'pending' }]);
    // Fin du lot (setBusy(false)) attendue dans le test : pas de mise à jour hors act().
    await waitFor(() => expect(screen.getByLabelText(/Choisir des fichiers/)).not.toBeDisabled());
  });

  it('un seul fichier importé → brouillon enregistré puis #/preview/:id', async () => {
    const lib = await openTestLibrary();
    const sourceFiles = new Map<string, File>();
    const importFile = vi.fn(async (_f: File, onProgress?: (m: string, r: number) => void) => {
      onProgress?.('Reconnaissance du texte : page 3/13', 3 / 13);
      return {
        title: 'Cellule', usedOcr: false, quizDetected: true,
        chapters: [{ title: 'Quiz', text: words(10), included: true, flags: ['has-quiz' as const] }],
      };
    });
    renderAt('#/import', makeServices(lib, { importFile, sourceFiles }));
    const file = new File(['1'], 'cellule.pdf');
    pick([file]);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/preview\//));
    const id = window.location.hash.slice('#/preview/'.length);
    const saved = await lib.getNote(id);
    expect(saved).toMatchObject({ title: 'Cellule', quizMode: true, status: 'draft' });
    expect(sourceFiles.get(id)).toBe(file);
    expect((await lib.listChapters(id))[0].flags).toEqual(['has-quiz']);
  });

  it('aucun fichier importé : aucun cours créé', async () => {
    const lib = await openTestLibrary();
    const importFile = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderAt('#/import', makeServices(lib, { importFile }));
    await screen.findByRole('option', { name: 'Nouveau cours…' });
    pick([new File(['1'], 'a.pdf')]);
    await screen.findByText('La reconnaissance du texte a échoué. Vérifie ta connexion et réessaie.');
    expect(await lib.listCourses()).toEqual([]);
  });

  it('choix pas encore chargé : réutilise « Mes notes » existant au lieu d’en créer un second', async () => {
    const lib = await openTestLibrary();
    await lib.saveCourse({ id: 'mes', name: 'Mes notes', order: 0, updatedAt: 0 });
    let calls = 0;
    const slowLib = {
      ...lib,
      listCourses: () => (calls++ === 0 ? new Promise<never>(() => undefined) : lib.listCourses()),
    };
    const importFile = vi.fn(async () => ({
      title: 'Cellule', usedOcr: false, quizDetected: false,
      chapters: [{ title: 'Intro', text: words(10), included: true, flags: [] }],
    }));
    renderAt('#/import', makeServices(slowLib, { importFile }));
    pick([new File(['1'], 'cellule.pdf')]);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/preview\//));
    expect((await lib.listCourses()).map((c) => c.id)).toEqual(['mes']);
    expect(await lib.listNotes('mes')).toHaveLength(1);
  });
});
