import { useEffect, useState } from 'react';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function readRecord(key: string): string {
  const value = new URL(window.location.href).searchParams.get(key) || '';
  return uuid.test(value) ? value : '';
}

/** Record identities are navigation state, never write commands or bearer tracking credentials. */
export function useUrlRecord(key: string) {
  const [id, setId] = useState(() => readRecord(key));
  useEffect(() => {
    const restore = () => setId(readRecord(key));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [key]);
  function select(next: string, related: Record<string, string> = {}) {
    if (next && !uuid.test(next)) return;
    setId(next);
    const url = new URL(window.location.href);
    if ((url.searchParams.get(key) || '') === next && Object.entries(related).every(([name, value]) => url.searchParams.get(name) === value)) return;
    if (next) url.searchParams.set(key, next);
    else url.searchParams.delete(key);
    for (const [name, value] of Object.entries(related)) url.searchParams.set(name, value);
    window.history.pushState(null, '', url);
  }
  return [id, select] as const;
}
