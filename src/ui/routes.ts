import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'course'; id: string }
  | { name: 'import'; courseId?: string }
  | { name: 'preview'; noteId: string }
  | { name: 'player' }
  | { name: 'settings' };

/** `#/course/abc` → `{ name: 'course', id: 'abc' }` ; toute adresse inconnue mène à la bibliothèque. */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const [head, arg] = parts;
  if (head === 'course' && arg) return { name: 'course', id: arg };
  if (head === 'preview' && arg) return { name: 'preview', noteId: arg };
  if (head === 'import') {
    const courseId = new URLSearchParams(query).get('course') ?? undefined;
    return courseId ? { name: 'import', courseId } : { name: 'import' };
  }
  if (head === 'player') return { name: 'player' };
  if (head === 'settings') return { name: 'settings' };
  return { name: 'library' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'library':
      return '#/';
    case 'course':
      return `#/course/${encodeURIComponent(route.id)}`;
    case 'import':
      return route.courseId ? `#/import?course=${encodeURIComponent(route.courseId)}` : '#/import';
    case 'preview':
      return `#/preview/${encodeURIComponent(route.noteId)}`;
    case 'player':
      return '#/player';
    case 'settings':
      return '#/settings';
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** Route courante, mise à jour à chaque `hashchange`. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}
