import { useState } from 'react';
import { normalizeImageUrl } from '../lib/ids';

// §3.2.2：作品圖片。整個擴充功能只有這個元件可以寫 <img>（ESLint react/forbid-elements），
// src 一律再經過 normalizeImageUrl()（只接受 https://img.dlsite.jp），不符或載入失敗時顯示內建的預設圖。
// storage 讀回的 imageUrl 只驗證長度，所以顯示前在這裡再檢查一次。
export function WorkImage({ url, className }: { url: string; className?: string }) {
  const src = normalizeImageUrl(url);
  const [failed, setFailed] = useState(false);
  if (src === '' || failed) return <Placeholder className={className} />;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      data-testid="work-image"
      onError={() => setFailed(true)}
    />
  );
}

/** 內建的預設圖（不發任何請求）。 */
function Placeholder({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 4 3" role="img" aria-label="沒有圖片" className={className} data-testid="work-image-placeholder">
      <rect width="4" height="3" fill="#e5e7eb" />
      <path d="M1 2.2 1.7 1.4 2.3 2 2.7 1.6 3.2 2.2Z" fill="#9ca3af" />
      <circle cx="2.8" cy="0.9" r="0.25" fill="#9ca3af" />
    </svg>
  );
}
