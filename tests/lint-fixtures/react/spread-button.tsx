// @lint-as: src/entrypoints/popup/Fixture.tsx
// @expect: react/jsx-props-no-spreading
export const X = (props: Record<string, string>) => <button type="button" {...props} />;
