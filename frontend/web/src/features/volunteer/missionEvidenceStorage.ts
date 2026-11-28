import { isPendingUploadRetained, restoreUpload, uploadScope, type StoredUpload, type UploadEntry } from './missionEvidenceState';
let database: Promise<IDBDatabase> | undefined;
let generation = 0;
export const evidenceStorageGeneration = () => generation;
function open() {
  database ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('c48-pending-mission-evidence', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('uploads', { keyPath: 'id' }).createIndex('scope', 'scope');
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Không mở được vùng lưu tệp chờ.'));
  }).catch(error => { database = undefined; throw error; });
  return database;
}
async function mutate(action: (store: IDBObjectStore) => void) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('uploads', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    try { action(transaction.objectStore('uploads')); }
    catch (error) { transaction.abort(); reject(error); }
  });
}
// Sweep every scope, including missions no longer opened, without loading file bytes into the UI.
export async function purgeExpiredEvidence() {
  await mutate(store => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!isPendingUploadRetained(cursor.value as StoredUpload)) cursor.delete();
      cursor.continue();
    };
  });
}
export async function loadPendingEvidence(userId: string, missionId: string) {
  const expectedGeneration = generation;
  await purgeExpiredEvidence();
  const db = await open();
  const rows = await new Promise<StoredUpload[]>((resolve, reject) => {
    const request = db.transaction('uploads').objectStore('uploads').index('scope').getAll(uploadScope(userId, missionId));
    request.onsuccess = () => resolve(request.result as StoredUpload[]);
    request.onerror = () => reject(request.error);
  });
  if (generation !== expectedGeneration) return [];
  const entries: UploadEntry[] = [];
  for (const row of rows.sort((a, b) => (a.queuedAt ?? a.updatedAt) - (b.queuedAt ?? b.updatedAt))) {
    const entry = restoreUpload(row, uploadScope(userId, missionId));
    if (entry) entries.push(entry);
    else await removePendingEvidence(row.id);
  }
  return entries;
}
export async function savePendingEvidence(userId: string, missionId: string, entry: UploadEntry, expectedGeneration: number, previousKey?: string) {
  if (generation !== expectedGeneration) return false;
  await mutate(store => {
    if (generation !== expectedGeneration) return;
    if (previousKey && previousKey !== entry.key) store.delete(previousKey);
    store.put({ id: entry.key, scope: uploadScope(userId, missionId), file: entry.file, name: entry.file.name,
      lastModified: entry.file.lastModified, queuedAt: entry.queuedAt, updatedAt: Date.now(), state: entry.state } satisfies StoredUpload);
  });
  return generation === expectedGeneration;
}
export function removePendingEvidence(key: string) { return mutate(store => { store.delete(key); }); }
export function clearPendingEvidence() {
  generation++;
  return mutate(store => { store.clear(); }).catch(() => { /* Local storage must not block logout. */ });
}
