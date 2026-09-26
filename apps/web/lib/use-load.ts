'use client';
import { useEffect, useState } from 'react';

export type Loadable<T> = { state: 'loading' } | { state: 'error'; error: Error } | { state: 'ready'; data: T };

/** Small fetch hook: re-runs when deps change, ignores stale responses. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loadable<T> {
  const [v, setV] = useState<Loadable<T>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    setV({ state: 'loading' });
    fn().then(
      (data) => live && setV({ state: 'ready', data }),
      (error: Error) => live && setV({ state: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, deps);
  return v;
}
