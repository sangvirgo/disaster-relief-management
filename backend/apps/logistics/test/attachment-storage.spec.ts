import { loadAttachmentStorageConfig } from '../src/attachments/attachment-storage';

describe('Logistics evidence storage configuration', () => {
  it('accepts only the private Logistics bucket and its service credentials', () => {
    const env = {
      NODE_ENV: 'production',
      S3_ENDPOINT: 'https://minio.internal/',
      S3_PUBLIC_ENDPOINT: 'https://files.example.test/',
      S3_BUCKET: 'c48-logistics-evidence',
      S3_ACCESS_KEY: 'logistics-service',
      S3_SECRET_KEY: 'logistics-secret-key-for-this-test',
    };

    expect(loadAttachmentStorageConfig(env)).toMatchObject({
      bucket: 'c48-logistics-evidence',
      accessKey: 'logistics-service',
      endpoint: 'https://minio.internal/',
      publicEndpoint: 'https://files.example.test/',
    });
    expect(() => loadAttachmentStorageConfig({ ...env, S3_BUCKET: 'c48-response-evidence' }))
      .toThrow(/Invalid Logistics configuration/u);
  });

  it('uses an isolated in-memory bucket configuration in unit-test mode', () => {
    const config = loadAttachmentStorageConfig({ NODE_ENV: 'test' });

    expect(config.bucket).toBe('c48-logistics-evidence');
    expect(config.endpoint).toBe('http://memory-storage.test');
  });
});
