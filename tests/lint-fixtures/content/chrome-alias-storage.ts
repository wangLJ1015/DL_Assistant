// @lint-as: src/entrypoints/dlsite-content.ts
// @expect: no-restricted-syntax
const c = chrome;
void c.storage.local.get(null);
