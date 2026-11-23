// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
export function f(el: HTMLElement, u: string) {
  el.style.backgroundImage = u;
}
