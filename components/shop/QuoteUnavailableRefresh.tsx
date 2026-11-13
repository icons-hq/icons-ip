'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 주문서가 스스로 재견적해 줄이 주문 불가로 바뀌었는데 화면의 카탈로그(판매기간)는 아직 옛 값일 때, 서버 속성을 한 번 다시 읽는다.
 * 새 카탈로그에 판매기간이 반영되면 주문서가 '판매기간이 끝난 굿즈가 있어요: <이름>' 한 줄로 안내한다(QA2 S-W1m-02).
 * 같은 불가 줄 조합(signature)에서는 한 번만 읽어 재고 부족처럼 판매기간과 무관한 불가가 새로 고침을 되풀이하지 않는다.
 */
export function QuoteUnavailableRefresh({ signature }: { signature: string | null }) {
  const router = useRouter();
  useEffect(() => { if (signature) router.refresh(); }, [signature, router]);
  return null;
}
