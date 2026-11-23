// §3.3：fixture 不能含 encrypted_code 或 email。
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(import.meta.dirname, 'fixtures');

function list(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(join(dir, e.name)) : [join(dir, e.name)]));
}

describe('tests/fixtures privacy scan', () => {
  it.each(list(DIR))('%s has no encrypted_code or email', (file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('encrypted_code');
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/);
  });
});
