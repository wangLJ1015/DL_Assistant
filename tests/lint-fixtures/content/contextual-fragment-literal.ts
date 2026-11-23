// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
export const f = document.createRange().createContextualFragment('<img src=x>');
