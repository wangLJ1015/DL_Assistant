// @lint-as: src/entrypoints/dlsite-content.ts
// @expect: no-restricted-syntax
export const f = (el: HTMLElement) => el.dispatchEvent(new Event('click'));
