// @lint-as: src/entrypoints/dlsite-content.ts
// @expect: no-restricted-syntax
export const f = (el: HTMLElement, s: string) => el.setAttribute('href', s);
