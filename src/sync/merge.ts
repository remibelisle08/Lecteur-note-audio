import type { Snapshot, Tombstone } from '../types';

/** Les tombstones plus anciennes que 90 jours sont purgées. */
export const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;

type Stamped = { updatedAt: number };

/** Dernière écriture gagne (enregistrement entier) ; à égalité, la version locale est gardée. */
function lww<T extends Stamped>(local: T[], remote: T[], key: (x: T) => string, combine?: (win: T, lose: T) => T): T[] {
  const out = new Map<string, T>();
  for (const x of local) out.set(key(x), x);
  for (const r of remote) {
    const l = out.get(key(r));
    if (!l) out.set(key(r), r);
    else {
      const [win, lose] = r.updatedAt > l.updatedAt ? [r, l] : [l, r];
      out.set(key(r), combine ? combine(win, lose) : win);
    }
  }
  return [...out.values()];
}

/**
 * Fusionne deux instantanés de la bibliothèque (local et Drive).
 * - Par entité : `updatedAt` le plus récent gagne.
 * - `audioDriveId` présent d'un seul côté (même chapitre) est conservé.
 * - Une tombstone avec `deletedAt ≥ updatedAt` retire l'entité.
 * - Pas d'orphelins : une note sans cours, un chapitre ou une progression sans note sont retirés
 *   (la suppression d'un cours emporte ses notes, celle d'une note ses chapitres et sa progression).
 * - Tombstones : union (deletedAt max par entité), purge après 90 jours.
 */
export function mergeSnapshots(local: Snapshot, remote: Snapshot, now = Date.now()): Snapshot {
  const tombs = new Map<string, Tombstone>();
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    const k = `${t.kind}:${t.id}`;
    const prev = tombs.get(k);
    if (!prev || t.deletedAt > prev.deletedAt) tombs.set(k, t);
  }
  const deletedAt = (kind: Tombstone['kind'], id: string) => tombs.get(`${kind}:${id}`)?.deletedAt ?? -Infinity;
  const alive = (kind: Tombstone['kind'], id: string, updatedAt: number) => deletedAt(kind, id) < updatedAt;

  const courses = lww(local.courses, remote.courses, (c) => c.id).filter((c) => alive('course', c.id, c.updatedAt));
  // Pas d'orphelins : une note exige son cours, un chapitre et une progression exigent leur note.
  const courseIds = new Set(courses.map((c) => c.id));
  const notes = lww(local.notes, remote.notes, (x) => x.id).filter(
    (x) => alive('note', x.id, x.updatedAt) && courseIds.has(x.courseId),
  );
  const noteIds = new Set(notes.map((x) => x.id));
  const chapters = lww(local.chapters, remote.chapters, (c) => c.id, (win, lose) =>
    win.audioDriveId === undefined && lose.audioDriveId !== undefined ? { ...win, audioDriveId: lose.audioDriveId } : win,
  ).filter((c) => alive('chapter', c.id, c.updatedAt) && noteIds.has(c.noteId));
  const progress = lww(local.progress, remote.progress, (p) => p.noteId).filter((p) => noteIds.has(p.noteId));
  const tombstones = [...tombs.values()].filter((t) => now - t.deletedAt <= TOMBSTONE_TTL_MS);

  return { version: 1, courses, notes, chapters, progress, tombstones };
}
