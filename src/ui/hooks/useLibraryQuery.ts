import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { ChangeKind, Library } from '../../library/db';
import { useApp } from '../AppContext';

export type Query<T> = { data?: T; error?: unknown; loading: boolean; reload: () => void };

/**
 * Charge des données de la bibliothèque et les recharge à chaque modification
 * (`kinds` : types de changements suivis). Les réponses périmées sont ignorées.
 */
export function useLibraryQuery<T>(
  load: (lib: Library) => Promise<T>,
  deps: DependencyList,
  kinds: ChangeKind[] = ['library'],
): Query<T> {
  const { lib } = useApp();
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  const run = useCallback(load, deps);
  const kindsKey = kinds.join(',');

  const reload = useCallback(() => {
    const my = ++seq.current;
    run(lib).then(
      (data) => {
        if (my === seq.current) setState({ data, loading: false });
      },
      (error: unknown) => {
        if (my === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
      },
    );
  }, [lib, run]);

  useEffect(() => {
    reload();
    const watched = kindsKey.split(',');
    const off = lib.onChange((kind) => {
      if (watched.includes(kind)) reload();
    });
    return () => {
      off();
      seq.current++;
    };
  }, [lib, reload, kindsKey]);

  return { ...state, reload };
}
