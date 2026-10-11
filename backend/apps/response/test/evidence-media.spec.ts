import { detectEvidenceMime, evidenceSizeLimit } from '../src/evidence/evidence-media';
import { loadEvidenceStorageConfig } from '../src/evidence/evidence-storage';

describe('Response evidence media validation', () => {
  it('accepts only JPEG, PNG, and MP4 container signatures', () => {
    expect(detectEvidenceMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectEvidenceMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectEvidenceMime(Buffer.from('0000ftypisom'))).toBe('video/mp4');
    expect(detectEvidenceMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined();
    expect(detectEvidenceMime(Buffer.from('<!doctype html>'))).toBeUndefined();
  });

  it('applies the documented per-media byte caps', () => {
    expect(evidenceSizeLimit('image/jpeg')).toBe(10 * 1024 * 1024);
    expect(evidenceSizeLimit('image/png')).toBe(10 * 1024 * 1024);
    expect(evidenceSizeLimit('video/mp4')).toBe(50 * 1024 * 1024);
  });

  it('keeps signed download links at the documented 60-second lifetime', () => {
    const config = {
      NODE_ENV: 'production', S3_ENDPOINT: 'https://storage.example.test',
      S3_PUBLIC_ENDPOINT: 'https://files.example.test', S3_BUCKET: 'c48-evidence',
      S3_ACCESS_KEY: 'test-access-key', S3_SECRET_KEY: 'test-secret-key-long-enough', SIGNED_URL_TTL_S: '60',
    };
    expect(loadEvidenceStorageConfig(config).signedUrlTtlSeconds).toBe(60);
    expect(() => loadEvidenceStorageConfig({ ...config, SIGNED_URL_TTL_S: '59' })).toThrow('Invalid Response configuration');
  });
});
