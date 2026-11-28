/** A legacy or stale review must not hide the action required by the resolution guard. */
export function hasCurrentFailureReview(mission: { id: string; version?: number }, events: readonly {
  event_type: string; payload?: Record<string, unknown> | null;
}[]): boolean {
  return mission.version != null && events.some(event => event.event_type === 'MISSION_FAILURE_REVIEW' &&
    event.payload?.mission_id === mission.id && Number(event.payload?.mission_version) === Number(mission.version));
}
