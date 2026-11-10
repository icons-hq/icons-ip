'use client';
import Link from 'next/link';
export default function GiftErrorBoundary({ retry }: { retry: () => void }) {
  return <main className="wc-root"><div className="wc-container wc-gifts"><h1>선물을 불러오지 못했어요</h1><p>잠시 후 다시 확인해주세요.</p><div className="wc-gifts__actions"><button type="button" onClick={retry}>다시 불러오기</button><Link href="/my">마이페이지로 이동</Link></div></div></main>;
}
