import { evidenceFileError } from '../../i18n/evidence.ts';

export type CountEvidence = {
  file: File;
  key: string;
  state: 'selected' | 'uploading' | 'ready' | 'failed';
  error: string;
};

/** Append selections like SOS intake; never silently replace or truncate selected files. */
export function appendCountEvidence(current: CountEvidence[], incoming: File[], newKey: () => string) {
  const result = [...current];
  const errors: string[] = [];
  for (const file of incoming) {
    if (result.some(entry => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) continue;
    const problem = evidenceFileError(file);
    if (problem) { errors.push(`${file.name}: ${problem}`); continue; }
    if (result.length >= 5) { errors.push('Chỉ chọn tối đa 5 tệp minh chứng. Các tệp đã chọn được giữ nguyên.'); break; }
    result.push({ file, key: newKey(), state: 'selected', error: '' });
  }
  return { entries: result, error: errors.join(' ') };
}

/** Each file keeps its idempotency key across retries, including an uncertain network response. */
export async function uploadCountEvidence(
  entries: CountEvidence[],
  send: (entry: CountEvidence) => Promise<{ state: string }>,
  update: (key: string, patch: Pick<CountEvidence, 'state' | 'error'>) => void,
) {
  let failed = 0;
  for (const entry of entries) {
    if (entry.state === 'ready') continue;
    update(entry.key, { state: 'uploading', error: '' });
    try {
      const result = await send(entry);
      if (result.state !== 'READY') throw new Error('Tệp đang được xử lý. Hãy thử gửi lại để kiểm tra kết quả.');
      update(entry.key, { state: 'ready', error: '' });
    } catch (cause) {
      failed++;
      update(entry.key, { state: 'failed', error: cause instanceof Error ? cause.message : 'Chưa tải được tệp. Hãy thử gửi lại.' });
    }
  }
  return failed;
}
