import type { ValidationError } from 'class-validator';
import { AppError } from '../errors/errors';

function collect(errors: readonly ValidationError[], prefix: string, into: Record<string, string[]>): void {
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const constraints = Object.keys(error.constraints ?? {});
    if (constraints.length) {
      const missing = error.value === undefined || error.value === null;
      const message = constraints.includes('whitelistValidation')
        ? 'Trường này không được hỗ trợ.'
        : missing ? 'Trường này là bắt buộc.' : 'Giá trị không hợp lệ.';
      (into[path] ??= []).push(message);
    }
    if (error.children?.length) collect(error.children, path, into);
  }
}

/** Reports which request fields failed validation, in Vietnamese and without echoing submitted values. */
export function validationExceptionFactory(errors: ValidationError[]): AppError {
  const fieldErrors: Record<string, string[]> = {};
  collect(errors, '', fieldErrors);
  return new AppError('VALIDATION_FAILED', {
    status: 400,
    ...(Object.keys(fieldErrors).length ? { fieldErrors } : {}),
  });
}
