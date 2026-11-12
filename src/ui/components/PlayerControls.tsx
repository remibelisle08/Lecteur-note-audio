import type { PlayerState } from '../../player/controller';
import { useApp } from '../AppContext';

/** Commande lecture/pause, en évitant les promesses rejetées non gérées. */
export function usePlayPause(state: PlayerState) {
  const { player } = useApp();
  return () => {
    if (state.playing) {
      player.pause();
      return;
    }
    player.unlock();
    player.play().catch(() => undefined);
  };
}

export function PlayPauseButton({ state, large = false }: { state: PlayerState; large?: boolean }) {
  const toggle = usePlayPause(state);
  return (
    <button
      type="button"
      className={`icon-btn play-btn${large ? ' play-btn-large' : ''}`}
      aria-label={state.playing ? 'Pause' : 'Lecture'}
      onClick={toggle}
    >
      {state.playing ? '❚❚' : '▶'}
    </button>
  );
}
