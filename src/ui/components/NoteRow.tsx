import { CHAPTER_ERROR_MESSAGE, QUOTA_MESSAGE } from '../../tts/generator';
import type { Chapter, Note, Progress } from '../../types';
import { useApp } from '../AppContext';
import { FALLBACK_ERROR } from '../format';
import { freeListenedAudio, freedMessage } from '../freeAudio';
import { noteRatio } from '../generationStore';
import { useGeneration } from '../hooks/useGeneration';
import { useListen } from '../hooks/useListen';
import { href } from '../routes';

export const STALLED_MESSAGE = 'La génération s’est interrompue.';

export type NoteRowData = { note: Note; chapters: Chapter[]; progress?: Progress };

type Props = NoteRowData & {
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
};

export function NoteRow({ note, chapters, progress, first, last, onMove, onDelete }: Props) {
  const { lib, generator, generation, driveConnected, notify } = useApp();
  const gen = useGeneration(note.id);
  const listen = useListen();

  const included = chapters.filter((c) => c.included);
  const done = new Set(progress?.completedChapterIds ?? []);
  const listened = included.filter((c) => done.has(c.id)).length;
  const hasErrorChapters = included.some((c) => c.audioStatus === 'error');
  const generating = note.status === 'generating';
  // Note « generating » que le générateur ne traite pas (reprise au démarrage échouée, arrêt) : relançable.
  const stalled = generating && !generator.isQueued(note.id);
  const error = !generating
    ? undefined
    : (gen.error ?? (hasErrorChapters ? CHAPTER_ERROR_MESSAGE : stalled ? STALLED_MESSAGE : undefined));

  let status: string;
  if (note.status === 'draft') status = 'Brouillon';
  else if (note.status === 'ready') status = 'Prête';
  else status = `Génération… ${Math.round(noteRatio(chapters, gen) * 100)} %`;

  const retry = () => {
    generation.clearError(note.id);
    generator.generateNote(note.id).catch(() => notify(CHAPTER_ERROR_MESSAGE));
  };
  const free = async () => {
    try {
      notify(freedMessage(await freeListenedAudio(lib)));
    } catch {
      notify(FALLBACK_ERROR);
    }
  };

  return (
    <li className="card note-row">
      <div className="note-main">
        <h3 className="list-title">{note.title}</h3>
        <p className="muted">
          <span className={`badge badge-${note.status}`}>{status}</span>
          {note.status !== 'draft' && (
            <span>{`${listened}/${included.length} ${included.length > 1 ? 'chapitres écoutés' : 'chapitre écouté'}`}</span>
          )}
        </p>
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            <div className="row">
              <button type="button" className="btn" onClick={retry}>
                Réessayer
              </button>
              {error === QUOTA_MESSAGE && driveConnected && (
                <button type="button" className="btn" onClick={() => void free()}>
                  Libérer l'audio des notes écoutées
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="row note-actions">
        {note.status === 'draft' ? (
          <a className="btn btn-primary" href={href({ name: 'preview', noteId: note.id })}>
            Relire et générer
          </a>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            aria-label={`Écouter « ${note.title} »`}
            onClick={() => void listen({ noteId: note.id })}
          >
            ▶ Écouter
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={`Monter « ${note.title} »`}
          disabled={first}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Descendre « ${note.title} »`}
          disabled={last}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <button type="button" className="icon-btn" aria-label={`Supprimer « ${note.title} »`} onClick={onDelete}>
          🗑
        </button>
      </div>
    </li>
  );
}
