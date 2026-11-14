import { useEffect } from 'react';

type InlineScrollStyles = {
  rootOverflow: string;
  bodyOverflow: string;
  bodyPaddingRight: string;
};

let activeLocks = 0;
let previousStyles: InlineScrollStyles | null = null;
let savedScrollX = 0;
let savedScrollY = 0;

export function acquireModalScrollLock(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return () => {};

  if (activeLocks === 0) {
    const root = document.documentElement;
    const body = document.body;
    savedScrollX = window.scrollX;
    savedScrollY = window.scrollY;
    previousStyles = {
      rootOverflow: root.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    };

    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const bodyPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`;
  }

  activeLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks = Math.max(0, activeLocks - 1);
    if (activeLocks > 0 || !previousStyles) return;

    document.documentElement.style.overflow = previousStyles.rootOverflow;
    document.body.style.overflow = previousStyles.bodyOverflow;
    document.body.style.paddingRight = previousStyles.bodyPaddingRight;
    previousStyles = null;
    window.scrollTo(savedScrollX, savedScrollY);
  };
}

export function useModalScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    return acquireModalScrollLock();
  }, [locked]);
}
