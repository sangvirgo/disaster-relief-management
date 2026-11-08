export function appendPage<T>(current: T[], incoming: T[], key: (item: T) => string): T[] {
  const merged = new Map(current.map(item => [key(item), item]));
  for (const item of incoming) merged.set(key(item), item);
  return [...merged.values()];
}
