import { useCallback, useState } from 'react';

export const LIST_PAGE_SIZE = 10;

/**
 * Cursor navigation with history. Drop-in for `useState(cursor)`:
 * setCursor('' | null) resets to the first page; setCursor(nextCursor) goes forward; prev() goes back.
 */
export function useCursorNav<C extends string | null>(empty: C) {
  const [nav, setNav] = useState<{ cursor: C; stack: C[] }>({ cursor: empty, stack: [] });
  const setCursor = useCallback((value: C) => {
    setNav((current) => !value ? (current.stack.length || current.cursor ? { cursor: empty, stack: [] } : current)
      : value === current.cursor ? current : { cursor: value, stack: [...current.stack, current.cursor] });
  }, [empty]);
  const prev = useCallback(() => {
    setNav((current) => current.stack.length
      ? { cursor: current.stack[current.stack.length - 1], stack: current.stack.slice(0, -1) } : current);
  }, []);
  return [nav.cursor, setCursor, prev, nav.stack.length] as const;
}
