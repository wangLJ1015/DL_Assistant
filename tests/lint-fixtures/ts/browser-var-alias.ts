// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
import { browser } from 'wxt/browser';
const b = browser;
void b.tabs.create({ url: 'https://example.com/' });
