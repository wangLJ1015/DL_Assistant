// @lint-as: src/entrypoints/dlsite-content.ts
// @expect: no-restricted-syntax
export const f = (el: HTMLElement, n: string) => el.setAttribute(n, '');
