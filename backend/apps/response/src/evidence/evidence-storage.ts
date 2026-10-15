import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { EvidenceMime } from '../../../../packages/technical/src/media/evidence-media';

export const RESPONSE_EVIDENCE_STORAGE = Symbol('RESPONSE_EVIDENCE_STORAGE');

export interface EvidenceObjectStorage {
  putObject(key: string, path: string, size: number, mime: EvidenceMime, checksum: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  signedGetUrl(key: string, expiresIn: number): Promise<string>;
}

export interface EvidenceStorageConfig {
  nodeEnv: string;
  endpoint: string;
  publicEndpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  signedUrlTtlSeconds: number;
}

function validEndpoint(value: string, allowHttp: boolean): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
  } catch {
    return false;
  }
}

export function loadEvidenceStorageConfig(env: Record<string, string | undefined> = process.env): EvidenceStorageConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv === 'test') {
    return {
      nodeEnv, endpoint: env.S3_ENDPOINT ?? 'http://memory-storage.test',
      publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? 'http://memory-storage.test',
      bucket: env.S3_BUCKET ?? 'c48-response-evidence', accessKey: env.S3_ACCESS_KEY ?? 'test-access-key',
      secretKey: env.S3_SECRET_KEY ?? 'test-secret-key-not-for-deployment', signedUrlTtlSeconds: 60,
    };
  }
  const endpoint = env.S3_ENDPOINT ?? '';
  const publicEndpoint = env.S3_PUBLIC_ENDPOINT ?? '';
  const bucket = env.S3_BUCKET ?? '';
  const accessKey = env.S3_ACCESS_KEY ?? '';
  const secretKey = env.S3_SECRET_KEY ?? '';
  const signedUrlTtlSeconds = Number(env.SIGNED_URL_TTL_S ?? 60);
  const allowHttp = nodeEnv !== 'production';
  if (!validEndpoint(endpoint, true) || !validEndpoint(publicEndpoint, allowHttp) ||
      !/^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/.test(bucket) || !accessKey || !secretKey || secretKey.length < 16 ||
      signedUrlTtlSeconds !== 60) {
    throw new Error('Invalid Response configuration: S3_ENDPOINT, S3_PUBLIC_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, SIGNED_URL_TTL_S');
  }
  return { nodeEnv, endpoint, publicEndpoint, bucket, accessKey, secretKey, signedUrlTtlSeconds };
}

@Injectable()
export class S3EvidenceStorage implements EvidenceObjectStorage {
  private readonly internal: S3Client;
  private readonly public: S3Client;

  constructor(private readonly config: EvidenceStorageConfig) {
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
      Bucket: this.config.bucket,
      Key: key,
      Body: createReadStream(path),
      ContentLength: size,
      ContentType: mime,
      ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
    }));
  }

  async deleteObject(key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  signedGetUrl(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(this.public, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { expiresIn });
  }
}

export class MemoryEvidenceStorage implements EvidenceObjectStorage {
  constructor(private readonly fail = false) {}

  async putObject(_key: string, path: string, size: number): Promise<void> {
    if (this.fail) throw new Error('test storage outage');
    let actual = 0;
    for await (const chunk of createReadStream(path)) actual += Buffer.byteLength(chunk);
    if (actual !== size) throw new Error('test object size mismatch');
  }

  async deleteObject(_key: string): Promise<void> {
    if (this.fail) throw new Error('test storage outage');
  }

  async signedGetUrl(key: string, expiresIn: number): Promise<string> {
    if (this.fail) throw new Error('test storage outage');
    return `http://memory-storage.test/${encodeURIComponent(key)}?expires=${expiresIn}`;
  }
}

export function createEvidenceStorage(config: EvidenceStorageConfig): EvidenceObjectStorage {
  if (config.nodeEnv === 'test') return new MemoryEvidenceStorage(process.env.TEST_S3_FAIL === 'true');
  return new S3EvidenceStorage(config);
}
