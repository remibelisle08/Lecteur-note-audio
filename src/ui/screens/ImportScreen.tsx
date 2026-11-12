import { useEffect, useState, type DragEvent } from 'react';
import { newId } from '../../library/db';
import type { Course } from '../../types';
import { useApp } from '../AppContext';
import { BackLink } from '../components/BackLink';
import { DEFAULT_COURSE_NAME, NO_CHAPTERS, OCR_TIP, importErrorMessage, saveDraft } from '../drafts';
import { useLibraryQuery } from '../hooks/useLibraryQuery';
import { href, navigate } from '../routes';

const LAST_COURSE_KEY = 'lastCourseId';
const NEW = '__new__';

type FileRow = { key: string; name: string; message?: string; ratio?: number; error?: string; noteId?: string; title?: string; usedOcr?: boolean };

function readLastCourse(): string | null {
  try {
    return localStorage.getItem(LAST_COURSE_KEY);
  } catch {
    return null;
  }
}
function writeLastCourse(id: string) {
  try {
    localStorage.setItem(LAST_COURSE_KEY, id);
  } catch {
    /* stockage indisponible : sans conséquence */
  }
}

function defaultChoice(courses: Course[], preferred?: string): string {
  for (const id of [preferred, readLastCourse()]) if (id && courses.some((c) => c.id === id)) return id;
  return courses.find((c) => c.name === DEFAULT_COURSE_NAME)?.id ?? NEW;
}

export function ImportScreen({ courseId }: { courseId?: string }) {
  const { lib, importFile, sourceFiles } = useApp();
  const { data: courses } = useLibraryQuery((l) => l.listCourses(), []);
  const [choice, setChoice] = useState<string | null>(null);
  const [newName, setNewName] = useState(DEFAULT_COURSE_NAME);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (courses && choice === null) setChoice(defaultChoice(courses, courseId));
  }, [courses, choice, courseId]);

  const update = (key: string, patch: Partial<FileRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function resolveCourse(): Promise<string> {
    if (choice && choice !== NEW) return choice;
    const name = newName.trim() || DEFAULT_COURSE_NAME;
    const existing = await lib.listCourses();
    const course = await lib.saveCourse({ id: newId(), name, order: existing.length, updatedAt: Date.now() });
    setChoice(course.id);
    return course.id;
  }

  async function handleFiles(list: FileList | File[] | null) {
    const files = list ? Array.from(list) : [];
    if (files.length === 0 || busy) return;
    const batch = files.map((f, i) => ({ file: f, row: { key: `${Date.now()}-${i}-${f.name}`, name: f.name } }));
    setRows(batch.map((b) => b.row));
    setBusy(true);
    let target: string;
    try {
      target = await resolveCourse();
      writeLastCourse(target);
    } catch {
      setRows((rs) => rs.map((r) => ({ ...r, error: 'Impossible de créer le cours. Réessaie.' })));
      setBusy(false);
      return;
    }
    const saved: string[] = [];
    for (const { file, row } of batch) {
      try {
        const result = await importFile(file, (message, ratio) => update(row.key, { message, ratio }));
        if (result.chapters.length === 0) {
          update(row.key, { error: NO_CHAPTERS, message: undefined });
          continue;
        }
        const note = await saveDraft(lib, target, file.name, result);
        sourceFiles.set(note.id, file);
        saved.push(note.id);
        update(row.key, { noteId: note.id, title: note.title, usedOcr: result.usedOcr, message: undefined });
      } catch (err) {
        update(row.key, { error: importErrorMessage(err), message: undefined });
      }
    }
    setBusy(false);
    if (batch.length === 1 && saved.length === 1) navigate({ name: 'preview', noteId: saved[0] });
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <>
      <BackLink />
      <header className="screen-header">
        <h1>Ajouter une note</h1>
      </header>

      <div className="card stack">
        <label htmlFor="course-choice">Cours</label>
        <select
          id="course-choice"
          value={choice ?? NEW}
          disabled={busy}
          onChange={(e) => setChoice(e.target.value)}
        >
          {courses?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW}>Nouveau cours…</option>
        </select>
        {(choice ?? NEW) === NEW && (
          <>
            <label htmlFor="new-course">Nom du nouveau cours</label>
            <input id="new-course" value={newName} disabled={busy} onChange={(e) => setNewName(e.target.value)} />
          </>
        )}
      </div>

      <label
        className={`dropzone${busy ? ' is-busy' : ''}`}
        htmlFor="file-input"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <span>Dépose tes fichiers ici (PDF ou Word .docx)</span>
        <span className="btn btn-primary">Choisir des fichiers</span>
        <input
          id="file-input"
          className="visually-hidden"
          type="file"
          accept=".pdf,.docx"
          multiple
          disabled={busy}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {rows.length > 0 && (
        <ul className="list" aria-label="Fichiers importés">
          {rows.map((r) => (
            <li key={r.key} className="card stack">
              <span className="list-title">{r.name}</span>
              {r.message && (
                <>
                  <span className="muted">{r.message}</span>
                  <progress max={1} value={r.ratio ?? 0} aria-label={`Avancement de ${r.name}`} />
                </>
              )}
              {r.error && (
                <p className="error" role="alert">
                  {r.error}
                </p>
              )}
              {r.noteId && (
                <a className="btn" href={href({ name: 'preview', noteId: r.noteId })}>
                  Relire « {r.title} »
                </a>
              )}
              {r.usedOcr && <p className="hint-text">{OCR_TIP}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
