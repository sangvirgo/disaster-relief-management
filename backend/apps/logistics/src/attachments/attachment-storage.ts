import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import type { EvidenceMime } from '@c48/technical/media/evidence-media';

export const LOGISTICS_ATTACHMENT_STORAGE = Symbol('LOGISTICS_ATTACHMENT_STORAGE');

export interface AttachmentStorage {
  putObject(key: string, path: string, size: number, mime: EvidenceMime, checksum: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  signedGetUrl(key: string, mime: EvidenceMime, expiresIn: number): Promise<string>;
}

export interface AttachmentStorageConfig {
  nodeEnv: string;
  endpoint: string;
  publicEndpoint: string;
  bucket: string;
  /** Static credentials for MinIO; omit both on AWS so the SDK uses the instance IAM role. */
  accessKey?: string | undefined;
  secretKey?: string | undefined;
  /** SigV4 signing region; must match the S3 bucket region on AWS. */
  region?: string;
}

const regionPattern = /^[a-z]{2}(?:-[a-z]+)+-\d$/;
// The Logistics bucket is c48-logistics-evidence, optionally with a globally-unique suffix on AWS S3.
const logisticsBucketPattern = /^c48-logistics-evidence(?:-[a-z0-9][a-z0-9-]*)?$/;

function validEndpoint(value: string, allowHttp: boolean): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
  } catch {
    return false;
  }
}

export function loadAttachmentStorageConfig(env: Record<string, string | undefined> = process.env): AttachmentStorageConfig {
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
  const accessKey = env.S3_ACCESS_KEY || undefined;
  const secretKey = env.S3_SECRET_KEY || undefined;
  const region = env.S3_REGION || 'us-east-1';
  const credentialsValid = (!accessKey && !secretKey) || (!!accessKey && !!secretKey && secretKey.length >= 16);
  if (!validEndpoint(endpoint, true) || !validEndpoint(publicEndpoint, nodeEnv !== 'production') ||
      bucket.length > 63 || !logisticsBucketPattern.test(bucket) || !credentialsValid || !regionPattern.test(region)) {
    throw new Error('Invalid Logistics configuration: S3_ENDPOINT, S3_PUBLIC_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION');
  }
  return { nodeEnv, endpoint, publicEndpoint, bucket, accessKey, secretKey, region };
}

export class S3AttachmentStorage implements AttachmentStorage {
  private readonly internal: S3Client;
  private readonly public: S3Client;

  constructor(private readonly config: AttachmentStorageConfig) {
    // Without static keys the SDK falls back to its default chain (EC2 instance IAM role).
    const credentials = config.accessKey && config.secretKey
      ? { credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey } }
      : {};
    const region = config.region ?? 'us-east-1';
    this.internal = new S3Client({
      endpoint: config.endpoint, region, forcePathStyle: true, ...credentials,
      requestHandler: { connectionTimeout: 3_000, socketTimeout: 30_000 },
    });
    this.public = new S3Client({
      endpoint: config.publicEndpoint, region, forcePathStyle: true, ...credentials,
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

export class MemoryAttachmentStorage implements AttachmentStorage {
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

export function createAttachmentStorage(config: AttachmentStorageConfig): AttachmentStorage {
  return config.nodeEnv === 'test' ? new MemoryAttachmentStorage() : new S3AttachmentStorage(config);
}
