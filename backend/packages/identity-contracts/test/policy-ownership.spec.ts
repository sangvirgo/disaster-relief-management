import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

it('keeps Identity authorization policy out of generic technical helpers', () => {
  const technical = join(process.cwd(), 'packages/technical/src');
  expect(readFileSync(join(technical, 'index.ts'), 'utf8')).not.toContain('./security/permissions');
  expect(existsSync(join(technical, 'security/permissions.ts'))).toBe(false);
  expect(existsSync(join(process.cwd(), 'packages/identity-contracts/src/permissions.ts'))).toBe(true);
});
