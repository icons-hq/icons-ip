'use client';

import { useActionState } from 'react';
import {
  publishAdminIpAction,
  unpublishAdminIpAction,
  type AdminIpPublishActionState,
} from '../../app/admin/ip-publish-actions';
import {
  ADMIN_IP_PUBLISH_STATE_LABELS,
  adminIpPublishState,
  type AdminIpPublishableRecord,
  type AdminIpPublishState,
} from '../../lib/admin/ip-publish';
import { Button } from '@/components/admin/kit/ui/button';
import { AdminNotice, AdminStatusBadge } from './console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { SECTION_CARD, SectionHeading } from './sections/SectionLayout';

const initialState: AdminIpPublishActionState = {};

/** 폼 머리와 목록이 쓰는 게시 상태 배지. 어휘는 게시 상태 이름이고, 색은 상태 톤이다. */
export function IpPublishStateBadge({ state }: { state: AdminIpPublishState }) {
  return (
    <span className="inline-flex" data-publish-state={state}>
      <AdminStatusBadge tone={statusTone('publication', state)}>{ADMIN_IP_PUBLISH_STATE_LABELS[state]}</AdminStatusBadge>
    </span>
  );
}

/*
 * 기존 IP 의 게시 상태 토글 — 보관 컨트롤 옆에 놓인다.
 *   초안 → "공개로 전환"  /  공개 → "초안으로 되돌리기"  /  보관 → 전환 불가 안내.
 * 호출부가 `${id}:${state}` 로 key 를 주어 상태가 바뀌면 다시 마운트된다 — 액션 함수가
 * 마운트 중에 바뀌지 않게 하려는 것이고, CatalogArchiveControl 과 같은 규약이다.
 */
export function IpPublishControl({
  id,
  record,
}: {
  id: string;
  record: AdminIpPublishableRecord;
}) {
  const state = adminIpPublishState(record);
  const publishing = state === 'draft';
  const action = publishing ? publishAdminIpAction : unpublishAdminIpAction;
  const [actionState, formAction, pending] = useActionState(action, initialState);

  return (
    <section className={SECTION_CARD} data-ip-publish-control={state}>
      <SectionHeading
        description={state === 'archived'
          ? '보관된 IP는 게시 상태를 바꿀 수 없습니다. 복원하면 초안이 됩니다. 다시 노출하려면 공개로 전환해주세요.'
          : publishing
            ? '공개하면 온라인 팝업 디렉토리·IP관·홈 특집·검색에 바로 노출됩니다.'
            : undefined}
        title={state === 'archived' ? '게시 상태' : publishing ? '공개로 전환' : '초안으로 되돌리기'}
      />
      {state === 'published' ? <AdminNotice tone="warning">초안으로 되돌리면 IP와 소속 상품·카드가 공개 목록·검색에서 제외됩니다. 이미 담긴 상품은 장바구니에 판매 종료로 표시되고 결제할 수 없습니다. 연결된 이벤트 상세는 찾을 수 없는 페이지(404)가 됩니다. 기존 주문·보유 카드 이력은 유지됩니다.</AdminNotice> : null}
      {actionState.errors?.form && <AdminNotice role="alert" tone="danger">{actionState.errors.form}</AdminNotice>}
      {actionState.errors?.id && <AdminNotice role="alert" tone="danger">{actionState.errors.id}</AdminNotice>}
      {actionState.message && <AdminNotice role="status" tone="success">{actionState.message}</AdminNotice>}
      {state !== 'archived' && (
        <form action={formAction} className="flex flex-col items-start gap-3">
          <input name="id" readOnly type="hidden" value={id} />
          {!publishing && (
            <label className="flex items-center gap-2 text-sm">
              <input disabled={pending} name="confirmUnpublish" required type="checkbox" value="yes" />
              <span>초안 전환의 영향을 확인했습니다</span>
            </label>
          )}
          <Button disabled={pending} type="submit" variant={publishing ? 'default' : 'destructive'}>
            {pending ? '처리 중' : publishing ? '공개로 전환' : '초안으로 되돌리기'}
          </Button>
        </form>
      )}
    </section>
  );
}
