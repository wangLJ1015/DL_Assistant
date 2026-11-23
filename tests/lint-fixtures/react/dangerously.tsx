// @lint-as: src/entrypoints/popup/Fixture.tsx
// @expect: react/no-danger
export const X = (h: string) => <div dangerouslySetInnerHTML={{ __html: h }} />;
