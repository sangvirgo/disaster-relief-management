/** Client metadata checks; the server still validates the actual file contents. */
export function evidenceFileError(file: Pick<File, 'type' | 'size'>): string | null {
  if (file.size === 0) return 'Tệp không có nội dung. Hãy chọn tệp khác.';
  if (!['image/jpeg', 'image/png', 'video/mp4'].includes(file.type))
    return 'Chỉ chọn ảnh JPEG, PNG hoặc video MP4.';
  const limit = file.type === 'video/mp4' ? 50 : 10;
  if (file.size > limit * 1024 * 1024)
    return `${file.type === 'video/mp4' ? 'Video' : 'Ảnh'} phải có dung lượng không quá ${limit} MB.`;
  return null;
}
