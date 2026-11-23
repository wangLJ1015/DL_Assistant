// §3.4「規則自我測試」：tests/lint-fixtures/ 的每個範例都必須以檔頭指定的規則報錯。
// 檔頭格式：
//   // @lint-as: <假裝成哪個檔案路徑，決定套用哪一組規則>
//   // @expect: <規則 id>（`none` 代表應該完全沒有錯誤，用來確認規則不會誤擋）
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_DIR = join(ROOT, 'tests/lint-fixtures');

function listFixtures(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFixtures(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

const fixtures = listFixtures(FIXTURE_DIR).map((file) => {
  const code = readFileSync(file, 'utf8');
  const as = /^\/\/ @lint-as: (\S+)$/m.exec(code)?.[1];
  const expectRule = /^\/\/ @expect: (\S+)$/m.exec(code)?.[1];
  return { file: relative(ROOT, file).replaceAll('\\', '/'), code, as, expectRule };
});

const eslint = new ESLint({ cwd: ROOT });

describe('lint fixtures', () => {
  it('每個範例都有 @lint-as 與 @expect', () => {
    for (const f of fixtures) {
      expect(f.as, f.file).toBeTruthy();
      expect(f.expectRule, f.file).toBeTruthy();
    }
  });

  it.each(fixtures)('$file → $expectRule', async ({ code, as, expectRule }) => {
    // lintText 只用 filePath 決定套用哪組規則，不會讀取或改寫那個檔案。
    const filePath = join(ROOT, as!);
    const [result] = await eslint.lintText(code, { filePath });
    const messages = result!.messages;
    expect(
      messages.filter((m) => m.fatal),
      'parse error',
    ).toEqual([]);
    const ruleIds = messages.map((m) => m.ruleId);
    if (expectRule === 'none') {
      expect(messages.map((m) => `${m.ruleId}: ${m.message}`)).toEqual([]);
    } else {
      expect(ruleIds).toContain(expectRule);
    }
  });

  it('§3.4 自我測試表的每一列都有範例', () => {
    const covered = new Set(fixtures.map((f) => f.file));
    const required = [
      'tests/lint-fixtures/react/a-href.tsx',
      'tests/lint-fixtures/react/form-action.tsx',
      'tests/lint-fixtures/react/meta-refresh.tsx',
      'tests/lint-fixtures/react/link.tsx',
      'tests/lint-fixtures/react/spread-div.tsx',
      'tests/lint-fixtures/react/spread-button.tsx',
      'tests/lint-fixtures/react/button-formaction.tsx',
      'tests/lint-fixtures/react/jsx-runtime-import.tsx',
      'tests/lint-fixtures/react/create-element-a.tsx',
      'tests/lint-fixtures/ts/browser-tabs-create.ts',
      'tests/lint-fixtures/ts/chrome-tabs-update.ts',
      'tests/lint-fixtures/ts/navigation-navigate.ts',
      'tests/lint-fixtures/ts/location-href.ts',
      'tests/lint-fixtures/ts/bare-open.ts',
      'tests/lint-fixtures/ts/destructure-tabs.ts',
      'tests/lint-fixtures/ts/as-brand.ts',
      'tests/lint-fixtures/content/img-src.ts',
      'tests/lint-fixtures/content/set-attribute-href.ts',
      'tests/lint-fixtures/content/click.ts',
      'tests/lint-fixtures/content/create-element-img.ts',
      'tests/lint-fixtures/content/storage-local-get.ts',
      // v0.9（M1 審查）
      'tests/lint-fixtures/ts/browser-import-alias.ts',
      'tests/lint-fixtures/ts/chrome-computed-tabs.ts',
      'tests/lint-fixtures/ts/window-computed-open.ts',
      'tests/lint-fixtures/ts/as-brand-qualified.ts',
      'tests/lint-fixtures/ts/brand-type-alias.ts',
      'tests/lint-fixtures/ts/z-coerce-import.ts',
      'tests/lint-fixtures/content/style-property.ts',
      'tests/lint-fixtures/content/set-attribute-ns-style.ts',
      'tests/lint-fixtures/content/set-attribute-node.ts',
      'tests/lint-fixtures/content/style-text-url.ts',
      'tests/lint-fixtures/content/constructed-stylesheet.ts',
      'tests/lint-fixtures/content/onmessage-property.ts',
      'tests/lint-fixtures/content/chrome-alias-storage.ts',
      'tests/lint-fixtures/content/chrome-computed-storage.ts',
      'tests/lint-fixtures/content/import-sibling-entry.ts',
    ];
    for (const r of required) expect(covered.has(r), r).toBe(true);
  });
});
