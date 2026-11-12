import { useApp } from '../AppContext';
import { usePlayerState } from '../hooks/usePlayerState';
import { href } from '../routes';
import { PlayPauseButton } from './PlayerControls';

/** Barre de lecture persistante en bas de l'écran (masquée sans élément chargé). */
export function MiniPlayer() {
  const { player } = useApp();
  const state = usePlayerState();
  const item = state.item;
  if (!item) return null;
  const ratio = state.duration > 0 ? Math.min(1, state.position / state.duration) : 0;
  return (
    <section className="mini-player" aria-label="Lecture en cours">
      <div className="mini-progress" style={{ width: `${ratio * 100}%` }} aria-hidden="true" />
      <a className="mini-info" href={href({ name: 'player' })} aria-label={`Ouvrir le lecteur : ${item.title}`}>
        <span className="mini-title">{item.title}</span>
        <span className="mini-sub">
          {state.unavailable ?? (state.waitingForAudio ? 'En cours de génération…' : item.noteTitle)}
        </span>
      </a>
      <button type="button" className="icon-btn" aria-label="Reculer de 15 secondes" onClick={() => player.seekBy(-15)}>
        −15
      </button>
      <PlayPauseButton state={state} />
    </section>
  );
}
