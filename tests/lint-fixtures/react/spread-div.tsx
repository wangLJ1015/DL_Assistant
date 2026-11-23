// @lint-as: src/entrypoints/popup/Fixture.tsx
// @expect: react/jsx-props-no-spreading
export const X = (props: Record<string, string>) => <div {...props} />;
