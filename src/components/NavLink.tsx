import type { ReactNode } from 'react';
import { NAV_URLS, type NavName } from '../lib/nav';

// §3.4 第 2 層：nav.ts 常數的連結。參數是常數名稱，不接受網址。
export function NavLink({ name, className, children }: { name: NavName; className?: string; children: ReactNode }) {
  const href: string = NAV_URLS[name];
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
