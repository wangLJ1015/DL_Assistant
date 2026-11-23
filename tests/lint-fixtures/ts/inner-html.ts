// @lint-as: src/lib/fixture.ts
// @expect: no-unsanitized/property
export const f = (el: HTMLElement, s: string) => {
  el.innerHTML = s;
};
