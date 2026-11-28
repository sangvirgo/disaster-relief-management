import { useEffect } from 'react';
import { registerNavigationGuard } from './navigationGuard';

export function useUnsavedWork(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return;
    const unregister = registerNavigationGuard(() => window.confirm(message));
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty, message]);
}
