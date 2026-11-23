// @lint-as: src/lib/fixture.ts
// @expect: none
import { browser } from 'wxt/browser';
import type { DlsiteNavUrl } from './nav';
export const base = browser.runtime.getURL('/');
export function f(u: DlsiteNavUrl, m: Record<string, number>, k: string): [DlsiteNavUrl, number | undefined] {
  return [u, m[k]];
}
