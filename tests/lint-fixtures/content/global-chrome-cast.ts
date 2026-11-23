// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
type G = { chrome: { runtime: { id: string } } };
export const id = (globalThis as unknown as G).chrome.runtime.id;
