import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode; onReload?: () => void };

/** Filet de sécurité à la racine : une erreur de rendu affiche un message au lieu d'un écran blanc. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur d’affichage', error, info.componentStack);
  }

  private reload = () => {
    if (this.props.onReload) this.props.onReload();
    else window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="screen">
        <h1>Lecteur de notes</h1>
        <p className="error" role="alert">
          Oups, quelque chose s’est mal passé.
        </p>
        <button type="button" className="btn btn-primary" onClick={this.reload}>
          Recharger
        </button>
      </main>
    );
  }
}
