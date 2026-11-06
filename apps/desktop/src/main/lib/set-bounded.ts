/** Set `key` as the newest entry, dropping the oldest past `max` */
export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  if (map.size <= max) return;
  const oldest = map.keys().next();
  if (!oldest.done) map.delete(oldest.value);
}
