// @lint-as: src/entrypoints/dlsite-content.ts
// @expect: no-restricted-syntax
export const f = (img: HTMLImageElement, s: string) => {
  img.src = s;
};
