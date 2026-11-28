export type UploadEntry = { file: File; key: string; queuedAt?: number; state: 'pending' | 'uploading' | 'saved' | 'failed'; persisted: boolean; error?: string };
export type StoredUpload = { id: string; scope: string; file: Blob; name: string; lastModified: number; queuedAt?: number; updatedAt: number; state: UploadEntry['state']; error?: string };
export const uploadRetentionMs = 30 * 60 * 1000;
export const uploadScope = (userId: string, missionId: string) => JSON.stringify([userId, missionId]);
export const fileSignature = (file: File) => JSON.stringify([file.name, file.size, file.lastModified]);
export function isPendingUploadRetained(row: StoredUpload, now = Date.now()) {
  return !!row && Number.isFinite(row.updatedAt) && now - row.updatedAt <= uploadRetentionMs && row.updatedAt <= now + 60_000 && row.state !== 'saved';
}
export function nextUploadKey(code: string | undefined, key: string, create: () => string) {
  return code === 'STORAGE_UNAVAILABLE' ? create() : key;
}
export function restoreUpload(row: StoredUpload, expectedScope: string, now = Date.now()): UploadEntry | null {
  if (!row || row.scope !== expectedScope || typeof row.id !== 'string' || typeof row.name !== 'string' || !(row.file instanceof Blob) || !Number.isFinite(row.lastModified) ||
    !isPendingUploadRetained(row, now)) return null;
  return { file: new File([row.file], row.name, { type: row.file.type, lastModified: row.lastModified }), key: row.id, queuedAt: row.queuedAt ?? row.updatedAt,
    state: 'failed', persisted: true, error: 'Tệp chưa có xác nhận lưu từ máy chủ. Bấm “Thử lại” để tiếp tục.' };
}
