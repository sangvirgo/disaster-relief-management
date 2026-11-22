// A real 1x1 PNG. Evidence uploads are decoded (and large images downscaled) by the backend,
// so fixtures must be valid images; callers append unique bytes after IEND to vary the checksum.
export const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
