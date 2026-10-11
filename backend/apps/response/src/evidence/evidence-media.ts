export type EvidenceMime = 'image/jpeg' | 'image/png' | 'video/mp4';

const imageLimit = 10 * 1024 * 1024;
const videoLimit = 50 * 1024 * 1024;

export function detectEvidenceMime(sample: Buffer): EvidenceMime | undefined {
  const bytes = sample.subarray(0, 4_096);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  // shortcut: MP4 validates its container only; add bounded ffprobe checks before production video acceptance.
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  return undefined;
}

export function evidenceSizeLimit(mime: EvidenceMime): number {
  return mime === 'video/mp4' ? videoLimit : imageLimit;
}
