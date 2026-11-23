// §3.2.5：建置時列出 content script 打包進去的模組，寫到 .output/content-modules.json（不放進擴充功能）。
// check-manifest 讀它，和 scripts/content-modules.baseline.json 比對：出現沒列過的套件就失敗，要人工確認。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { CONTENT_SCRIPT_FILE } from './manifest-policy.ts';

const ROOT = resolve(import.meta.dirname, '..');
export const CONTENT_MODULES_FILE = join(ROOT, '.output/content-modules.json');

export interface ContentModule {
  /** 專案內的檔案是相對路徑（src/...）；套件是「套件名稱/檔案」。 */
  id: string;
  /** 套件名稱；專案內的檔案為 null。 */
  pkg: string | null;
  bytes: number;
}

/** 模組 id（絕對路徑，可能帶 \0 或 ?query）→ 可讀的 id 與套件名稱。 */
export function describeModule(rawId: string): Omit<ContentModule, 'bytes'> {
  const id = rawId.replace(/^\0/, '').replace(/\?.*$/, '').replaceAll('\\', '/');
  const nm = id.lastIndexOf('/node_modules/');
  if (nm >= 0) {
    const rest = id.slice(nm + '/node_modules/'.length);
    const parts = rest.split('/');
    const pkg = parts[0]!.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!;
    return { id: rest, pkg };
  }
  const rel = relative(ROOT, id).replaceAll('\\', '/');
  return { id: rel.startsWith('..') ? id : rel, pkg: null };
}

// vite 不是直接相依套件，只寫出用到的形狀（Rollup 的 OutputBundle）。
interface ChunkLike {
  type: string;
  fileName: string;
  modules?: Record<string, { renderedLength: number }>;
}

export function contentModulesPlugin() {
  return {
    name: 'dl-assistant:content-modules',
    apply: 'build' as const,
    generateBundle(_options: unknown, bundle: Record<string, ChunkLike>) {
      const chunk = Object.values(bundle).find((c) => c.type === 'chunk' && c.fileName === CONTENT_SCRIPT_FILE);
      if (!chunk?.modules) return;
      const modules: ContentModule[] = Object.entries(chunk.modules)
        .map(([rawId, m]) => ({ ...describeModule(rawId), bytes: m.renderedLength }))
        .filter((m) => m.bytes > 0)
        .sort((a, b) => a.id.localeCompare(b.id));
      mkdirSync(dirname(CONTENT_MODULES_FILE), { recursive: true });
      writeFileSync(CONTENT_MODULES_FILE, `${JSON.stringify({ file: CONTENT_SCRIPT_FILE, modules }, null, 2)}\n`);
    },
  };
}
