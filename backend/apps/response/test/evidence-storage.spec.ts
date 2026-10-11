import { S3EvidenceStorage } from '../src/evidence/evidence-storage';

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
