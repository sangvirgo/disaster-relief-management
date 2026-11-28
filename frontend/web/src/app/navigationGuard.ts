type LeaveGuard = () => boolean;
const guards = new Set<LeaveGuard>();

/** Page-owned transient work is checked before an explicit in-app navigation. */
export function registerNavigationGuard(guard: LeaveGuard) {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

export function canNavigateAway() {
  return [...guards].every(guard => guard());
}
