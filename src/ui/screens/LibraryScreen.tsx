import type { Library } from '../../library/db';
import type { Course, Note } from '../../types';
import { InstallHint } from '../components/InstallHint';
import { plural } from '../format';
import { useLibraryQuery } from '../hooks/useLibraryQuery';
import { useListen } from '../hooks/useListen';
import { href } from '../routes';

type Resume = { note: Note; courseName: string; chapterTitle?: string };
type LibraryData = { courses: { course: Course; notes: number }[]; resume?: Resume };

async function loadLibrary(lib: Library): Promise<LibraryData> {
  const courses = await lib.listCourses();
  const rows: LibraryData['courses'] = [];
  let best: { note: Note; course: Course; chapterIndex: number; at: number } | undefined;
  for (const course of courses) {
    const notes = await lib.listNotes(course.id);
    rows.push({ course, notes: notes.length });
    for (const note of notes) {
      if (note.status === 'draft') continue;
      const p = await lib.getProgress(note.id);
      if (p && (!best || p.updatedAt > best.at)) best = { note, course, chapterIndex: p.chapterIndex, at: p.updatedAt };
    }
  }
  let resume: Resume | undefined;
  if (best) {
    const chapters = await lib.listChapters(best.note.id);
    const chapterTitle = chapters.find((c) => c.index === best.chapterIndex)?.title;
    resume = { note: best.note, courseName: best.course.name, chapterTitle };
  }
  return { courses: rows, resume };
}

export function LibraryScreen() {
  const { data, error } = useLibraryQuery(loadLibrary, [], ['library', 'progress']);
  const listen = useListen();

  return (
    <>
      <header className="screen-header">
        <h1>Mes cours</h1>
        <a className="btn btn-ghost" href={href({ name: 'settings' })}>
          Réglages
        </a>
      </header>
      <InstallHint />

      {data?.resume && (
        <section className="card resume" aria-labelledby="resume-title">
          <h2 id="resume-title">Reprendre</h2>
          <p className="resume-note">{data.resume.note.title}</p>
          {data.resume.chapterTitle && <p className="muted">{data.resume.chapterTitle}</p>}
          <button
            type="button"
            className="btn btn-primary"
            aria-label={`Reprendre ${data.resume.note.title}`}
            onClick={() => void listen({ noteId: data.resume!.note.id })}
          >
            ▶ Reprendre
          </button>
        </section>
      )}

      {error !== undefined && <p className="error">Impossible de lire ta bibliothèque. Recharge la page.</p>}

      {data && data.courses.length === 0 && (
        <p className="empty">Aucun cours pour l’instant. Ajoute ta première note de cours pour l’écouter en balado.</p>
      )}

      {data && data.courses.length > 0 && (
        <ul className="list" aria-label="Cours">
          {data.courses.map(({ course, notes }) => (
            <li key={course.id}>
              <a className="list-item" href={href({ name: 'course', id: course.id })}>
                <span className="list-title">{course.name}</span>
                <span className="muted">{plural(notes, 'note', 'notes')}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <a className="btn btn-primary btn-block" href={href({ name: 'import' })}>
        + Ajouter une note
      </a>
    </>
  );
}
