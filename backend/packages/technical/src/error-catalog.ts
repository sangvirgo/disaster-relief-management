import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface CatalogEntry {
  status: number;
  message: string;
}

export type ErrorCatalog = ReadonlyMap<string, CatalogEntry>;

export function parseErrorCatalog(markdown: string): Map<string, CatalogEntry> {
  const catalog = new Map<string, CatalogEntry>();
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|\s*[^|]+\|\s*([^|]+?)\s*\|\s*$/);
    if (!match) continue;
    const [, code, status, message] = match;
    if (!code || !status || !message || catalog.has(code)) throw new Error('Invalid or duplicate API error catalog row');
    catalog.set(code, { status: Number(status), message });
  }
  if (!catalog.has('INTERNAL_ERROR') || !catalog.has('VALIDATION_FAILED')) {
    throw new Error('API error catalog is missing required shared codes');
  }
  return catalog;
}

export function loadErrorCatalog(): ErrorCatalog {
  const configured = process.env.C48_ERROR_CATALOG_PATH;
  const candidates = [
    ...(configured ? [resolve(configured)] : []),
    resolve(process.cwd(), 'docs/backend/07-error-catalog.md'),
    resolve(process.cwd(), '../docs/backend/07-error-catalog.md'),
  ];
  const path = candidates.find(existsSync);
  if (!path) throw new Error('Backend error catalog file was not found');
  return parseErrorCatalog(readFileSync(path, 'utf8'));
}
