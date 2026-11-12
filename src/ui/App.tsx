import { useEffect } from 'react';
import { AppProvider, type AppServices } from './AppContext';
import { MiniPlayer } from './components/MiniPlayer';
import { usePlayerHasItem } from './hooks/usePlayerState';
import { VoiceDownload } from './components/VoiceDownload';
import { useRoute, type Route } from './routes';
import { CourseScreen } from './screens/CourseScreen';
import { ImportScreen } from './screens/ImportScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { PreviewScreen } from './screens/PreviewScreen';
import { SettingsScreen } from './screens/SettingsScreen';
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
      <main className={`screen${mini ? ' has-mini' : ''}`}>
        <Screen route={route} />
      </main>
      {mini && <MiniPlayer />}
    </>
  );
}

/** Sans services (démarrage en cours) : écran d'accueil vide le temps d'ouvrir la bibliothèque. */
export function App({ services }: { services?: AppServices }) {
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
