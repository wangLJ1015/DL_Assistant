// @lint-as: src/lib/fixture.ts
// @expect: no-unsanitized/method
export const f = (el: HTMLElement, s: string) => el.insertAdjacentHTML('beforeend', s);
