import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { chapter, course, fakePlayer, makeServices, note, openTestLibrary, renderAt } from './helpers';

describe('LibraryScreen', () => {
  it('affiche les cours avec leur nombre de notes et le bloc « Reprendre »', async () => {
    const lib = await openTestLibrary();
    await lib.saveCourse(course('c1', 'Biologie', 0));
    await lib.saveCourse(course('c2', 'Chimie', 1));
    await lib.saveNote(note('n1', 'c1', { title: 'Cellule', status: 'ready' }));
    await lib.saveNote(note('n2', 'c1', { title: 'ADN', status: 'ready', order: 1 }));
    await lib.saveNote(note('n3', 'c2', { title: 'Atomes', status: 'ready' }));
    await lib.saveChapter(chapter('x', 'n2', 0, { title: 'La double hélice', audioStatus: 'ready' }));
    await lib.saveProgress({ noteId: 'n2', chapterIndex: 0, positionSec: 30, completedChapterIds: [], updatedAt: 0 });
    const { player } = fakePlayer();

    renderAt('#/', makeServices(lib, { player }));

    expect(screen.getByRole('heading', { name: 'Mes cours' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Biologie/ })).toHaveTextContent('2 notes');
    expect(screen.getByRole('link', { name: /Chimie/ })).toHaveTextContent('1 note');
    expect(await screen.findByRole('heading', { name: 'Reprendre' })).toBeInTheDocument();
    expect(screen.getByText('ADN')).toBeInTheDocument();
    expect(screen.getByText('La double hélice')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Ajouter une note' })).toHaveAttribute('href', '#/import');
    expect(screen.getByRole('link', { name: 'Réglages' })).toHaveAttribute('href', '#/settings');

    fireEvent.click(screen.getByRole('button', { name: /Reprendre ADN/ }));
    // Déverrouillage audio (iOS) synchrone dans le clic, avant le chargement.
    expect(player.unlock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(player.unlock).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(player.loadNote).mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(player.loadNote).toHaveBeenCalledWith('n2'));
    await waitFor(() => expect(player.play).toHaveBeenCalled());
    await waitFor(() => expect(window.location.hash).toBe('#/player'));
  });

  it('état vide : pas de bloc Reprendre', async () => {
    const lib = await openTestLibrary();
    renderAt('#/', makeServices(lib));
    expect(await screen.findByText(/Aucun cours pour l’instant/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reprendre' })).toBeNull();
  });

  it('erreur de chargement de la note à reprendre : message en français', async () => {
    const lib = await openTestLibrary();
    await lib.saveCourse(course('c1', 'Biologie'));
    await lib.saveNote(note('n1', 'c1', { title: 'Cellule', status: 'ready' }));
    await lib.saveProgress({ noteId: 'n1', chapterIndex: 0, positionSec: 0, completedChapterIds: [], updatedAt: 0 });
    const { player } = fakePlayer();
    player.loadNote = vi.fn(async () => {
      throw new Error('idb');
    });
    renderAt('#/', makeServices(lib, { player }));
    fireEvent.click(await screen.findByRole('button', { name: /Reprendre Cellule/ }));
    expect(await screen.findByText('Impossible d’ouvrir cette note. Réessaie.')).toBeInTheDocument();
  });
});
