import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { fakePlayer, makeServices, openTestLibrary, renderAt } from './helpers';

const item = { noteId: 'n1', chapterId: 'a', chapterIndex: 0, title: 'Introduction', noteTitle: 'Cellule', courseName: 'Bio' };

describe('MiniPlayer', () => {
  it('masqué quand rien n’est chargé, affiché ensuite, masqué sur l’écran du lecteur', async () => {
    const lib = await openTestLibrary();
    const fake = fakePlayer();
    renderAt('#/', makeServices(lib, { player: fake.player }));
    expect(screen.queryByRole('region', { name: 'Lecture en cours' })).toBeNull();

    act(() => fake.setState({ item, queue: [item] }));
    const bar = screen.getByRole('region', { name: 'Lecture en cours' });
    expect(bar).toHaveTextContent('Introduction');
    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }));
    expect(fake.player.unlock).toHaveBeenCalled();
    expect(fake.player.play).toHaveBeenCalled();

    act(() => {
      window.location.hash = '#/player';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.queryByRole('region', { name: 'Lecture en cours' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reculer de 15 secondes' })).toBeInTheDocument();
  });

  it('PlayerScreen : message d’attente si l’audio est en cours de génération', async () => {
    const lib = await openTestLibrary();
    const fake = fakePlayer({ item, queue: [item], waitingForAudio: true });
    renderAt('#/player', makeServices(lib, { player: fake.player }));
    expect(screen.getByText('Ce chapitre est en cours de génération…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Avancer de 15 secondes' }));
    expect(fake.player.seekBy).toHaveBeenCalledWith(15);
  });
});
