// @lint-as: src/entrypoints/dlsite-content.ts
// @expect: no-restricted-syntax
const { storage } = chrome;
void storage.local.get(null);
