// @lint-as: src/entrypoints/popup/Fixture.tsx
// @expect: react/forbid-dom-props
export const X = () => <button type="submit" formAction="https://example.com/">x</button>;
