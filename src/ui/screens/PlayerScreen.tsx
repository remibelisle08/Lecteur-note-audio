import { useApp } from '../AppContext';
import { BackLink } from '../components/BackLink';
import { PlayPauseButton } from '../components/PlayerControls';
import { formatRate, formatTime } from '../format';
import { usePlayerState } from '../hooks/usePlayerState';

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function PlayerScreen() {
  const { player } = useApp();
  const state = usePlayerState();
  const item = state.item;
  const safe = (p: Promise<unknown>) => void p.catch(() => undefined);

  if (!item) {
    return (
      <>
        <BackLink />
        <h1>Lecteur</h1>
        <p className="empty">Rien en lecture pour l’instant. Choisis une note dans un cours.</p>
      </>
    );
  }
  const max = state.duration > 0 ? state.duration : 0;
  const manyNotes = new Set(state.queue.map((q) => q.noteId)).size > 1;

  return (
    <>
      <BackLink />
      <header className="player-header">
        <p className="muted">{[item.courseName, item.noteTitle].filter(Boolean).join(' · ')}</p>
        <h1>{item.title}</h1>
      </header>

      {state.waitingForAudio && (
        <p className="card notice" role="status">
          Ce chapitre est en cours de génération…
        </p>
      )}
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="stack">
        <input
          type="range"
          className="seek"
          min={0}
          max={max || 1}
          step={1}
          value={max ? Math.min(state.position, max) : 0}
          disabled={max === 0}
          aria-label="Position dans le chapitre"
          aria-valuetext={`${formatTime(state.position)} sur ${formatTime(max)}`}
          onChange={(e) => player.seekTo(Number(e.target.value))}
        />
        <div className="row times muted">
          <span>{formatTime(state.position)}</span>
          <span>{max ? formatTime(max) : '–:––'}</span>
        </div>
      </div>

      <div className="transport">
        <button type="button" className="icon-btn" aria-label="Chapitre précédent" onClick={() => safe(player.prev())}>
          ⏮
        </button>
        <button type="button" className="icon-btn" aria-label="Reculer de 15 secondes" onClick={() => player.seekBy(-15)}>
          −15
        </button>
        <PlayPauseButton state={state} large />
        <button type="button" className="icon-btn" aria-label="Avancer de 15 secondes" onClick={() => player.seekBy(15)}>
          +15
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Chapitre suivant"
          disabled={state.index >= state.queue.length - 1}
          onClick={() => safe(player.next())}
        >
          ⏭
        </button>
      </div>

      <div className="row rate">
        <label htmlFor="rate">Vitesse</label>
        <select id="rate" value={state.rate} onChange={(e) => player.setRate(Number(e.target.value))}>
          {RATES.map((r) => (
            <option key={r} value={r}>
              {formatRate(r)}
            </option>
          ))}
        </select>
      </div>

      <section aria-labelledby="chapters-title">
        <h2 id="chapters-title">Chapitres</h2>
        <ol className="list chapter-list">
          {state.queue.map((q, i) => (
            <li key={q.chapterId}>
              <button
                type="button"
                className={`list-item${i === state.index ? ' is-current' : ''}`}
                aria-current={i === state.index ? 'true' : undefined}
                onClick={() => safe(player.goTo(i))}
              >
                <span className="list-title">{q.title}</span>
                {manyNotes && <span className="muted">{q.noteTitle}</span>}
              </button>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
