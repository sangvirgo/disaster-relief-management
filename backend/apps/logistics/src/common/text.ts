import { AppError } from '../../../../packages/technical/src/errors/errors';

export function cleanText(value: string, maxLength: number): string {
  if (!value || value.length > maxLength || !value.trim() || value !== value.normalize('NFC')) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
  return value;
}
