import { useEffect, useState } from 'react';

function currentView<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = new URL(window.location.href).searchParams.get(key);
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

export function useUrlView<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [view, setView] = useState<T>(() => currentView(key, allowed, fallback));

  useEffect(() => {
    const restore = () => setView(currentView(key, allowed, fallback));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [key, allowed, fallback]);

  function changeView(next: T) {
    if (next === view) return;
    setView(next);
    const url = new URL(window.location.href);
    if (url.searchParams.get(key) === next) return;
    url.searchParams.set(key, next);
    window.history.pushState(null, '', url);
  }

  return [view, changeView] as const;
}
