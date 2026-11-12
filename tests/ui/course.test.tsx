import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { chapter, course, fakeGenerator, makeServices, note, openTestLibrary, renderAt } from './helpers';
import { QUOTA_MESSAGE } from '../../src/tts/generator';

describe('CourseScreen', () => {
  it('affiche « 3/7 chapitres écoutés » et les états des notes', async () => {
    const lib = await openTestLibrary();
    await lib.saveCourse(course('c1', 'Biologie'));
    await lib.saveNote(note('n1', 'c1', { title: 'Cellule', status: 'ready', order: 0 }));
    await lib.saveNote(note('n2', 'c1', { title: 'ADN', status: 'draft', order: 1 }));
    for (let i = 0; i < 7; i++) await lib.saveChapter(chapter(`k${i}`, 'n1', i, { audioStatus: 'ready' }));
    await lib.saveProgress({ noteId: 'n1', chapterIndex: 3, positionSec: 0, completedChapterIds: ['k0', 'k1', 'k2'], updatedAt: 0 });

    renderAt('#/course/c1', makeServices(lib));
    expect(await screen.findByRole('heading', { name: 'Biologie' })).toBeInTheDocument();
    expect(await screen.findByText('3/7 chapitres écoutés')).toBeInTheDocument();
    expect(screen.getByText('Prête')).toBeInTheDocument();
    expect(screen.getByText('Brouillon')).toBeInTheDocument();
  });

  it('progression de génération globale de la note, puis erreur avec « Réessayer »', async () => {
    const lib = await openTestLibrary();
    await lib.saveCourse(course('c1', 'Biologie'));
    await lib.saveNote(note('n1', 'c1', { title: 'Cellule', status: 'generating' }));
    await lib.saveChapter(chapter('a', 'n1', 0, { audioStatus: 'ready' }));
    await lib.saveChapter(chapter('b', 'n1', 1, { audioStatus: 'generating' }));
    const generator = fakeGenerator();
    renderAt('#/course/c1', makeServices(lib, { generator }));
    await screen.findByText('Cellule');

    act(() => generator.emit({ noteId: 'n1', chapterId: 'b', ratio: 0.5, status: 'generating' }));
    expect(await screen.findByText('Génération… 75 %')).toBeInTheDocument();

    await lib.saveChapter(chapter('b', 'n1', 1, { audioStatus: 'error' }));
    act(() => generator.emit({ noteId: 'n1', chapterId: 'b', ratio: 0, status: 'error', message: QUOTA_MESSAGE }));
    expect(await screen.findByText(QUOTA_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Libérer l'audio des notes écoutées" })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Réessayer/ }));
    await waitFor(() => expect(generator.generateNote).toHaveBeenCalledWith('n1'));
  });

  it('réordonne les notes avec ↑/↓', async () => {
    const lib = await openTestLibrary();
    await lib.saveCourse(course('c1', 'Biologie'));
    await lib.saveNote(note('n1', 'c1', { title: 'Cellule', order: 0 }));
    await lib.saveNote(note('n2', 'c1', { title: 'ADN', order: 1 }));
    renderAt('#/course/c1', makeServices(lib));
    fireEvent.click(await screen.findByRole('button', { name: 'Monter « ADN »' }));
    await waitFor(async () => expect((await lib.listNotes('c1')).map((n) => n.id)).toEqual(['n2', 'n1']));
  });
});
