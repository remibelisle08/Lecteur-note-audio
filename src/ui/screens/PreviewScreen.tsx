import { useState } from 'react';
import type { ImportResult } from '../../import';
import { estimateMinutes } from '../../cleanup/chapters';
import { useApp } from '../AppContext';
import { BackLink } from '../components/BackLink';
import { ChapterEditor } from '../components/ChapterEditor';
import { NO_CHAPTERS, OCR_TIP, importErrorMessage } from '../drafts';
import { FALLBACK_ERROR } from '../format';
import { SAVE_ERROR, useDraft } from '../hooks/useDraft';
import { href, navigate } from '../routes';

export function PreviewScreen({ noteId }: { noteId: string }) {
  const { lib, generator, importFile, sourceFiles, notify } = useApp();
  const draft = useDraft(noteId);
  const { note, chapters } = draft;
  const [ocr, setOcr] = useState<{ message?: string; error?: string; busy: boolean }>({ busy: false });
  const [starting, setStarting] = useState(false);

  if (note === undefined) return <p className="muted">Chargement…</p>;
  if (note === null) {
    return (
      <>
        <BackLink />
        <p className="empty">Cette note n’existe plus.</p>
      </>
    );
  }
  const back = <BackLink to={href({ name: 'course', id: note.courseId })} label="Retour au cours" />;
  if (note.status !== 'draft') {
    return (
      <>
        {back}
        <p className="empty">L’audio de cette note a déjà été généré.</p>
      </>
    );
  }

  const included = chapters.filter((c) => c.included);
  const minutes = estimateMinutes(included.map((c) => c.text).join('\n'));
  const file = sourceFiles.get(noteId);
  const canOcr = !!file && file.name.toLowerCase().endsWith('.pdf');

  const retryOcr = async () => {
    if (!file) return;
    setOcr({ busy: true, message: 'Reconnaissance du texte…' });
    let result: ImportResult;
    try {
      result = await importFile(file, (message) => setOcr({ busy: true, message }), { forceOcr: true });
    } catch (err) {
      setOcr({ busy: false, error: importErrorMessage(err) });
      return;
    }
    if (result.chapters.length === 0) {
      setOcr({ busy: false, error: NO_CHAPTERS });
      return;
    }
    try {
      await draft.replaceChapters(result);
      setOcr({ busy: false });
    } catch {
      // Échec d'enregistrement (bibliothèque), pas de la reconnaissance de texte.
      setOcr({ busy: false, error: SAVE_ERROR });
    }
  };

  const generate = async () => {
    setStarting(true);
    try {
      await draft.flush();
      const current = await lib.getNote(noteId);
      if (current) {
        await lib.setLocalGeneration(noteId, true);
        await lib.saveNote({ ...current, status: 'generating' });
      }
    } catch {
      setStarting(false);
      notify(FALLBACK_ERROR);
      return;
    }
    generator.generateNote(noteId).catch(() => notify('La génération a échoué. Réessaie depuis le cours.'));
    navigate({ name: 'course', id: note.courseId });
  };

  return (
    <>
      {back}
      <header className="screen-header">
        <h1>Aperçu</h1>
      </header>

      <div className="card stack">
        <label htmlFor="note-title">Titre de la note</label>
        <input id="note-title" value={note.title} onChange={(e) => draft.updateNote({ title: e.target.value })} />
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={note.quizMode}
            onChange={(e) => draft.updateNote({ quizMode: e.target.checked })}
          />
          Mode quiz
        </label>
        <p className="muted">
          Durée estimée : <strong>≈ {minutes} min</strong>
        </p>
        {note.usedOcr && <p className="hint-text">{OCR_TIP}</p>}
        {canOcr && (
          <button type="button" className="link-btn" disabled={ocr.busy} onClick={() => void retryOcr()}>
            Le texte semble incorrect ? Réessayer avec la reconnaissance de texte
          </button>
        )}
        {ocr.message && ocr.busy && <p className="muted" role="status">{ocr.message}</p>}
        {ocr.error && (
          <p className="error" role="alert">
            {ocr.error}
          </p>
        )}
      </div>

      {chapters.map((ch, i) => (
        <ChapterEditor
          key={ch.id}
          chapter={ch}
          position={i + 1}
          isLast={i === chapters.length - 1}
          onChange={(patch, immediate) => draft.updateChapter(ch.id, patch, immediate)}
          onMerge={() => void draft.mergeWithNext(i)}
        />
      ))}

      <div className="sticky-actions card stack">
        <p className="muted">Garde l'app ouverte pendant la génération.</p>
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={included.length === 0 || starting || ocr.busy}
          onClick={() => void generate()}
        >
          Générer l'audio
        </button>
      </div>
    </>
  );
}
