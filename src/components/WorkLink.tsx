import type { ReactNode } from 'react';
import { buildWorkUrl } from '../lib/ids';

// §3.4 第 2 層：可以寫 <a href> 的三個元件之一。href 只能來自 buildWorkUrl()。
export function WorkLink({ site, id, className, children }: { site: string; id: string; className?: string; children: ReactNode }) {
  return (
    <a href={buildWorkUrl(site, id)} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
