import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import type { EvidenceMime } from '../../../../packages/technical/src/media/evidence-media';

export const LOGISTICS_ATTACHMENT_STORAGE = Symbol('LOGISTICS_ATTACHMENT_STORAGE');

export interface DonationAttachmentStorage {
  putObject(key: string, path: string, size: number, mime: EvidenceMime, checksum: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  signedGetUrl(key: string, mime: EvidenceMime, expiresIn: number): Promise<string>;
}

export interface DonationAttachmentStorageConfig {
  nodeEnv: string;
  endpoint: string;
  publicEndpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

function validEndpoint(value: string, allowHttp: boolean): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
  } catch {
    return false;
  }
}

export function loadDonationAttachmentStorageConfig(env: Record<string, string | undefined> = process.env): DonationAttachmentStorageConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv === 'test') {
    return {
      nodeEnv, endpoint: env.S3_ENDPOINT ?? 'http://memory-storage.test',
      publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? 'http://memory-storage.test',
      bucket: 'c48-logistics-evidence', accessKey: 'test-logistics-access-key',
      secretKey: 'test-logistics-secret-key-not-for-deployment',
    };
  }
  const endpoint = env.S3_ENDPOINT ?? '';
  const publicEndpoint = env.S3_PUBLIC_ENDPOINT ?? '';
  const bucket = env.S3_BUCKET ?? '';
  const accessKey = env.S3_ACCESS_KEY ?? '';
  const secretKey = env.S3_SECRET_KEY ?? '';
  if (!validEndpoint(endpoint, true) || !validEndpoint(publicEndpoint, nodeEnv !== 'production') ||
      bucket !== 'c48-logistics-evidence' || !accessKey || !secretKey || secretKey.length < 16) {
    throw new Error('Invalid Logistics configuration: S3_ENDPOINT, S3_PUBLIC_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY');
  }
  return { nodeEnv, endpoint, publicEndpoint, bucket, accessKey, secretKey };
}

export class S3DonationAttachmentStorage implements DonationAttachmentStorage {
  private readonly internal: S3Client;
  private readonly public: S3Client;

  constructor(private readonly config: DonationAttachmentStorageConfig) {
    const credentials = { accessKeyId: config.accessKey, secretAccessKey: config.secretKey };
    this.internal = new S3Client({
      endpoint: config.endpoint, region: 'us-east-1', forcePathStyle: true, credentials,
      requestHandler: { connectionTimeout: 3_000, socketTimeout: 30_000 },
    });
    this.public = new S3Client({
      endpoint: config.publicEndpoint, region: 'us-east-1', forcePathStyle: true, credentials,
      requestHandler: { connectionTimeout: 3_000, socketTimeout: 30_000 },
    });
  }

  async putObject(key: string, path: string, size: number, mime: EvidenceMime, checksum: string): Promise<void> {
    await this.internal.send(new PutObjectCommand({
      Bucket: this.config.bucket, Key: key, Body: createReadStream(path), ContentLength: size, ContentType: mime,
      ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
    }));
  }

  async deleteObject(key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  signedGetUrl(key: string, mime: EvidenceMime, expiresIn: number): Promise<string> {
    return getSignedUrl(this.public, new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ResponseContentType: mime,
      ResponseContentDisposition: 'attachment; filename="evidence"',
      ResponseCacheControl: 'no-store',
    }), { expiresIn });
  }
}

export class MemoryDonationAttachmentStorage implements DonationAttachmentStorage {
  async putObject(key: string, path: string, size: number): Promise<void> {
    let actual = 0;
    for await (const chunk of createReadStream(path)) actual += Buffer.byteLength(chunk);
    if (actual !== size) throw new Error(`Attachment ${key} size mismatch`);
  }

  async deleteObject(_key: string): Promise<void> {}

  async signedGetUrl(key: string, _mime: EvidenceMime, expiresIn: number): Promise<string> {
    return `http://memory-storage.test/${encodeURIComponent(key)}?expires=${expiresIn}`;
  }
}

export function createDonationAttachmentStorage(config: DonationAttachmentStorageConfig): DonationAttachmentStorage {
  return config.nodeEnv === 'test' ? new MemoryDonationAttachmentStorage() : new S3DonationAttachmentStorage(config);
}
