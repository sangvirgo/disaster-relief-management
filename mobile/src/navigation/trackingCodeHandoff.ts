let nextTrackingCode: string | null = null;

/** Passes the bearer tracking code to the next in-app tracking screen without putting it in a URL. */
export function queueTrackingCodeForNavigation(code: string): void {
  nextTrackingCode = code.trim().toUpperCase();
}

/** Consumes a one-time in-memory tracking code queued by another screen. */
export function consumeTrackingCodeForNavigation(): string | null {
  const code = nextTrackingCode;
  nextTrackingCode = null;
  return code;
}
