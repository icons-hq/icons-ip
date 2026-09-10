'use client';

import { useActionState } from 'react';
import { setAdminGoodPublishedAction } from '@/app/admin/goods-publish-actions';

export function GoodPublishControls({ id, publishedAt, archivedAt }: { id: string; publishedAt: string | null; archivedAt: string | null }) {
  const [state, action, pending] = useActionState(setAdminGoodPublishedAction, {});
  const published = Boolean(publishedAt);
  return <section className="card col" style={{ padding: 18, gap: 12 }}>
    <h2 style={{ fontSize: 18 }}>게시 상태 · {archivedAt ? '보관' : published ? '공개' : '초안'}</h2>
    <p className="muted">{archivedAt ? '복원하면 초안으로 돌아옵니다. 공개하려면 필수 항목을 확인해주세요.'
      : published ? '초안으로 되돌리면 목록·검색·상품 상세에서 숨겨지고, 장바구니에서는 판매 종료로 표시되어 새 주문을 할 수 없습니다. 기존 주문과 결제·취소 처리는 유지됩니다.'
        : '공개 전환에는 상품 유형·대표 이미지·상품정보제공고시 7칸·출고지·옵션과 KC 검토 완료가 필요합니다. 연결 IP도 공개되어야 고객에게 보입니다.'}</p>
    {state.error && <p role="alert">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
    {!archivedAt && <form action={action}>
      <input name="id" type="hidden" value={id}/><input name="published" type="hidden" value={String(!published)}/>
      {published && <label style={{ display: 'block', marginBottom: 12 }}><input name="confirmUnpublish" required type="checkbox" value="yes"/> 초안 전환의 영향을 확인했습니다</label>}
      <button className="btn btn-ghost" disabled={pending}>{pending ? '처리 중…' : published ? '초안으로 되돌리기' : '공개로 전환'}</button>
    </form>}
  </section>;
}
