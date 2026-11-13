import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../src/ui/components/ErrorBoundary';
import { fakePlayer, makeServices, openTestLibrary, renderAt } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

function Boom(): JSX.Element {
  throw new Error('boum');
}

describe('ErrorBoundary', () => {
  it('erreur de rendu dans l’app → message en français et bouton « Recharger »', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lib = await openTestLibrary();
    const fake = fakePlayer();
    fake.player.subscribe = () => {
      throw new Error('boum');
    };
    renderAt('#/player', makeServices(lib, { player: fake.player }));
    expect(await screen.findByText('Oups, quelque chose s’est mal passé.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeInTheDocument();
  });

  it('« Recharger » recharge la page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onReload = vi.fn();
    render(
      <ErrorBoundary onReload={onReload}>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recharger' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('sans erreur : affiche les enfants', () => {
    render(
      <ErrorBoundary>
        <p>contenu</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });
});
