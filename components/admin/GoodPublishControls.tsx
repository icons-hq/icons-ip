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
    <p>이 작업은 서버에 저장된 상품의 게시 상태만 바꿉니다. 기본 폼의 미저장 입력은 유지되며 함께 저장되지 않습니다.</p>
    <details><summary>KC 재검토와 기존 공개 상품 안내</summary>
      <p>모델·옵션·고시정보를 수정하면 실제 상품과 검토 근거가 달라질 수 있어 초안 전환과 KC 재검토가 필요합니다. 수정 후 KC 검토를 완료하고 다시 공개해주세요.</p>
      <p>해당 없음도 검토 생략을 뜻하지 않습니다. KC 영역에서 적용 제도와 판단 사유·근거·고객 안내·적용 옵션을 기록하고 현재 검토 절차를 진행합니다.</p>
      <p>기존 공개 · KC 미기록 상품은 자동 승인이나 자동 공개 중지로 처리하지 않습니다. 초안으로 전환한 뒤 재공개하려면 현재 KC 검토 요건을 충족해야 합니다.</p>
    </details>
    {!archivedAt && <form action={action}>
      <input name="id" type="hidden" value={id}/><input name="published" type="hidden" value={String(!published)}/>
      {published && <label style={{ display: 'block', marginBottom: 12 }}><input name="confirmUnpublish" required type="checkbox" value="yes"/> 초안 전환의 영향을 확인했습니다</label>}
      <button className="btn btn-ghost" disabled={pending}>{pending ? '처리 중…' : published ? '초안으로 되돌리기' : '공개로 전환'}</button>
    </form>}
  </section>;
}
