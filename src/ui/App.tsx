import { useEffect, useState } from 'react';
import { AppProvider, useApp, type AppServices } from './AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MiniPlayer } from './components/MiniPlayer';
import { usePlayerHasItem } from './hooks/usePlayerState';
import { VoiceDownload } from './components/VoiceDownload';
import { useDriveState } from './hooks/useDrive';
import { useRoute, type Route } from './routes';
import { CourseScreen } from './screens/CourseScreen';
import { ImportScreen } from './screens/ImportScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { PreviewScreen } from './screens/PreviewScreen';
import { DRIVE_CONNECT_ERROR, SettingsScreen } from './screens/SettingsScreen';
import './styles.css';

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'library':
      return <LibraryScreen />;
    case 'course':
      return <CourseScreen key={route.id} id={route.id} />;
    case 'import':
      return <ImportScreen courseId={route.courseId} />;
    case 'preview':
      return <PreviewScreen key={route.noteId} noteId={route.noteId} />;
    case 'player':
      return <PlayerScreen />;
    case 'settings':
      return <SettingsScreen />;
  }
}

/** Bandeau quand l'autorisation Drive a expiré : la lecture continue, seule la synchro attend. */
function DriveReconnect() {
  const { drive, notify } = useApp();
  const { connected, status } = useDriveState(drive);
  if (!drive || !connected || status.state !== 'auth-required') return null;
  const reconnect = () => {
    drive.connect().catch(() => notify(DRIVE_CONNECT_ERROR));
  };
  return (
    <div className="banner banner-row" role="status">
      <span>Synchro Drive en pause.</span>
      <button type="button" className="btn" onClick={reconnect}>
        Reconnecter Drive
      </button>
    </div>
  );
}

/** Nouvelle version déployée : le service worker attend ; « Recharger » l'applique tout de suite. */
function UpdateBanner() {
  const [apply, setApply] = useState<null | (() => void)>(null);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let cancelled = false;
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        const update = registerSW({
          onNeedRefresh() {
            if (!cancelled) setApply(() => () => void update(true));
          },
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!apply) return null;
  return (
    <div className="banner banner-row" role="status">
      <span>Nouvelle version disponible —</span>
      <button type="button" className="btn" onClick={apply}>
        Recharger
      </button>
    </div>
  );
}

function Shell() {
  const route = useRoute();
  const hasItem = usePlayerHasItem();
  const mini = route.name !== 'player' && hasItem;
  useEffect(() => {
    // Nouvel écran : on repart du haut (scrollTop plutôt que scrollTo, absent de jsdom).
    document.documentElement.scrollTop = 0;
  }, [route.name]);
  return (
    <>
      <VoiceDownload />
      <DriveReconnect />
      <UpdateBanner />
      <main className={`screen${mini ? ' has-mini' : ''}`}>
        <Screen route={route} />
      </main>
      {mini && <MiniPlayer />}
    </>
  );
}

/** Racine de l'app, protégée par un filet d'erreurs (message + « Recharger » plutôt qu'un écran blanc). */
export function App({ services }: { services?: AppServices }) {
  return (
    <ErrorBoundary>
      <Root services={services} />
    </ErrorBoundary>
  );
}

/** Sans services (démarrage en cours) : écran d'accueil vide le temps d'ouvrir la bibliothèque. */
function Root({ services }: { services?: AppServices }) {
  if (!services) {
    return (
      <main className="screen">
        <header className="screen-header">
          <h1>Mes cours</h1>
        </header>
        <p className="muted">Chargement…</p>
      </main>
    );
  }
  return (
    <AppProvider services={services}>
      <Shell />
    </AppProvider>
  );
}
