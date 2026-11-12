import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { openLibrary, type Library } from './library/db';
import { App } from './ui/App';
import { createServices } from './ui/services';

const root = createRoot(document.getElementById('root')!);
const render = (node: JSX.Element) => root.render(<StrictMode>{node}</StrictMode>);

async function start() {
  render(<App />);
  let lib: Library;
  try {
    lib = await openLibrary();
  } catch {
    render(
      <main className="screen">
        <h1>Mes cours</h1>
        <p className="error">
          Impossible d’ouvrir la bibliothèque sur cet appareil (navigation privée ?). Recharge la page ou ouvre l’app
          dans une fenêtre normale.
        </p>
      </main>,
    );
    return;
  }
  const services = createServices(lib);
  // Reprise des générations interrompues : en tâche de fond, le rendu n'attend pas la fin des générations.
  services.generator.resumeAll().catch(() => undefined);
  render(<App services={services} />);
}

void start();
