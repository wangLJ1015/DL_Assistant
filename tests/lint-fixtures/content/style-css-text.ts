// @lint-as: src/entrypoints/dlsite-content.ts
// @expect: no-restricted-syntax
export const f = (el: HTMLElement) => {
  el.style.cssText = 'background:url(x)';
};
