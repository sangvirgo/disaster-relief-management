export type SupportedEvidenceMimeType = 'image/jpeg' | 'image/png' | 'video/mp4';

export interface EvidenceAssetInfo {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  type?: string | null;
}

const MIME_BY_EXTENSION: Record<string, SupportedEvidenceMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
};

export function getSupportedEvidenceMimeType(asset: EvidenceAssetInfo): SupportedEvidenceMimeType | undefined {
  const reportedMimeType = asset.mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  if (reportedMimeType === 'image/jpeg' || reportedMimeType === 'image/png' || reportedMimeType === 'video/mp4') {
    return reportedMimeType;
  }

  for (const name of [asset.fileName, asset.uri]) {
    const path = name?.split(/[?#]/, 1)[0];
    const extension = path?.match(/\.([^.\/]+)$/)?.[1]?.toLowerCase();
    if (extension && MIME_BY_EXTENSION[extension]) return MIME_BY_EXTENSION[extension];
  }

  return undefined;
}

export function getEvidenceSizeLimitBytes(mimeType: SupportedEvidenceMimeType): number {
  return mimeType === 'video/mp4' ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
}
