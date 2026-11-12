import { render, screen } from '@testing-library/react';
import { App } from '../src/ui/App';

describe('smoke', () => {
  it('affiche le titre Mes cours', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Mes cours' })).toBeInTheDocument();
  });
});
