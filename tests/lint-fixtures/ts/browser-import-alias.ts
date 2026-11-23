// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
import { browser as b } from 'wxt/browser';
void b.tabs.create({ url: 'https://example.com/' });
