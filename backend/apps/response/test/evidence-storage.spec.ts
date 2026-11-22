import { loadEvidenceStorageConfig, S3EvidenceStorage } from '../src/evidence/evidence-storage';

describe('Response S3 storage configuration', () => {
  const awsEnv = {
    NODE_ENV: 'production',
    S3_ENDPOINT: 'https://s3.ap-southeast-2.amazonaws.com/',
    S3_PUBLIC_ENDPOINT: 'https://s3.ap-southeast-2.amazonaws.com/',
    S3_BUCKET: 'c48-response-evidence-xtri123',
    S3_REGION: 'ap-southeast-2',
  };

  it('uses the instance IAM role when no static key is set and keeps the signing region', async () => {
    const config = loadEvidenceStorageConfig(awsEnv);
    expect(config).toMatchObject({ bucket: 'c48-response-evidence-xtri123', region: 'ap-southeast-2' });
    expect(config.accessKey).toBeUndefined();
    const storage = new S3EvidenceStorage(config);
    try {
      await expect(storage['internal'].config.region()).resolves.toBe('ap-southeast-2');
      await expect(storage['public'].config.region()).resolves.toBe('ap-southeast-2');
    } finally {
      storage['internal'].destroy();
      storage['public'].destroy();
    }
  });

  it('rejects half-configured static credentials and malformed regions', () => {
    expect(() => loadEvidenceStorageConfig({ ...awsEnv, S3_ACCESS_KEY: 'only-an-access-key' }))
      .toThrow('Invalid Response configuration');
    expect(() => loadEvidenceStorageConfig({ ...awsEnv, S3_REGION: 'Sydney' })).toThrow('Invalid Response configuration');
  });
});

describe('Response S3 storage timeouts', () => {
  it('bounds connection and socket waits for internal and signed-URL clients', async () => {
    const storage = new S3EvidenceStorage({
      nodeEnv: 'production', endpoint: 'https://minio.internal/', publicEndpoint: 'https://files.example.test/',
      bucket: 'c48-response-evidence', accessKey: 'test-access-key', secretKey: 'test-secret-key-not-for-deployment',
      signedUrlTtlSeconds: 60,
    });
    try {
      for (const client of [storage['internal'], storage['public']]) {
        const handler = await client.config.requestHandler;
        const sdkConfig = await (handler as unknown as { configProvider: Promise<{ connectionTimeout: number; socketTimeout: number }> }).configProvider;
        expect(sdkConfig).toMatchObject({ connectionTimeout: 3_000, socketTimeout: 30_000 });
      }
    } finally {
      storage['internal'].destroy();
      storage['public'].destroy();
    }
  });
});
