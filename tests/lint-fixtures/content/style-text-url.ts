// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
export function f(style: HTMLStyleElement) {
  style.textContent = '.x{background:url(https://www.dlsite.com/home/mypage/coupon)}';
}
