import { useState, type FormEvent } from 'react';
import type { Library } from '../../library/db';
import type { Course } from '../../types';
import { useApp } from '../AppContext';
import { BackLink } from '../components/BackLink';
import { NoteRow, type NoteRowData } from '../components/NoteRow';
import { FALLBACK_ERROR } from '../format';
import { useLibraryQuery } from '../hooks/useLibraryQuery';
import { useListen } from '../hooks/useListen';
import { href, navigate } from '../routes';

type CourseData = { course?: Course; notes: NoteRowData[] };

async function loadCourse(lib: Library, id: string): Promise<CourseData> {
  const course = (await lib.listCourses()).find((c) => c.id === id);
  if (!course) return { notes: [] };
  const notes: NoteRowData[] = [];
  for (const note of await lib.listNotes(id)) {
    notes.push({ note, chapters: await lib.listChapters(note.id), progress: await lib.getProgress(note.id) });
  }
  return { course, notes };
}

export function CourseScreen({ id }: { id: string }) {
  const { lib, notify } = useApp();
  const { data } = useLibraryQuery((l) => loadCourse(l, id), [id], ['library', 'progress']);
  const listen = useListen();
  const [renaming, setRenaming] = useState<string | null>(null);

  if (!data) return <p className="muted">Chargement…</p>;
  const course = data.course;
  if (!course) {
    return (
      <>
        <BackLink />
        <p className="empty">Ce cours n’existe plus.</p>
      </>
    );
  }

  const guard = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch {
      notify(FALLBACK_ERROR);
    }
  };

  const move = (i: number, delta: -1 | 1) =>
    guard(async () => {
      const order = data.notes.map((n) => n.note);
      const j = i + delta;
      [order[i], order[j]] = [order[j], order[i]];
      for (let k = 0; k < order.length; k++) {
        if (order[k].order !== k) await lib.saveNote({ ...order[k], order: k });
      }
    });

  const removeNote = (row: NoteRowData) => {
    if (!window.confirm(`Supprimer la note « ${row.note.title} » et son audio ?`)) return;
    void guard(() => lib.deleteNote(row.note.id));
  };

  const removeCourse = () => {
    if (!window.confirm(`Supprimer le cours « ${course.name} », toutes ses notes et leur audio ?`)) return;
    void guard(async () => {
      await lib.deleteCourse(course.id);
      navigate({ name: 'library' });
    });
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    const name = renaming?.trim();
    if (!name) return;
    void guard(async () => {
      await lib.saveCourse({ ...course, name });
      setRenaming(null);
    });
  };

  const playable = data.notes.some((n) => n.note.status !== 'draft');

  return (
    <>
      <BackLink />
      {renaming === null ? (
        <header className="screen-header">
          <h1>{course.name}</h1>
        </header>
      ) : (
        <form className="card stack" onSubmit={rename}>
          <label htmlFor="course-name">Nom du cours</label>
          <input id="course-name" value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
          <div className="row">
            <button type="submit" className="btn btn-primary">
              Enregistrer
            </button>
            <button type="button" className="btn" onClick={() => setRenaming(null)}>
              Annuler
            </button>
          </div>
        </form>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!playable}
        onClick={() => void listen({ courseId: course.id })}
      >
        ▶ Écouter tout le cours
      </button>

      {data.notes.length === 0 ? (
        <p className="empty">Aucune note dans ce cours.</p>
      ) : (
        <ul className="list" aria-label="Notes">
          {data.notes.map((row, i) => (
            <NoteRow
              key={row.note.id}
              {...row}
              first={i === 0}
              last={i === data.notes.length - 1}
              onMove={(d) => void move(i, d)}
              onDelete={() => removeNote(row)}
            />
          ))}
        </ul>
      )}

      <a className="btn btn-block" href={href({ name: 'import', courseId: course.id })}>
        + Ajouter une note
      </a>
      <div className="row">
        <button type="button" className="btn" onClick={() => setRenaming(course.name)}>
          Renommer le cours
        </button>
        <button type="button" className="btn btn-danger" onClick={removeCourse}>
          Supprimer le cours
        </button>
      </div>
    </>
  );
}
