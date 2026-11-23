// @lint-as: src/entrypoints/popup/Fixture.tsx
// @expect: none
export const X = ({ t }: { t: string }) => (
  <div className="p-1">
    <button type="button">{t}</button>
  </div>
);
