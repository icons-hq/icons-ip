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

const initialState: AdminIpPublishActionState = {};

const STATE_COLORS: Record<AdminIpPublishState, string> = {
  draft: 'var(--amber)',
  published: 'var(--mint)',
  archived: 'var(--dim)',
};

/** 폼 머리와 목록이 쓰는 게시 상태 배지. 색만 다르고 어휘는 기존 `.tag` 다. */
export function IpPublishStateBadge({ state }: { state: AdminIpPublishState }) {
  return (
    <span className="tag" data-publish-state={state} style={{ color: STATE_COLORS[state] }}>
      {ADMIN_IP_PUBLISH_STATE_LABELS[state]}
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
    <section className="card col" data-ip-publish-control={state} style={{ borderRadius: 10, gap: 12, padding: 18 }}>
      <div>
        <span className="eyebrow">PUBLISH STATE</span>
        <h2 style={{ fontSize: 18, margin: '6px 0 0' }}>
          {state === 'archived' ? '게시 상태' : publishing ? '공개로 전환' : '초안으로 되돌리기'}
        </h2>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        {state === 'archived'
          ? '보관된 IP는 게시 상태를 바꿀 수 없습니다. 복원하면 이전 게시 상태로 돌아오고, 게시 이력이 없으면 초안이 됩니다.'
          : publishing
            ? '공개하면 온라인 팝업 디렉토리·IP관·홈 특집·검색에 바로 노출됩니다.'
            : '초안으로 되돌리면 공개 화면에서 빠집니다. 소속 굿즈·카드도 함께 숨겨지지만, 이미 담긴 장바구니와 주문 이력은 유지됩니다.'}
      </p>
      {actionState.errors?.form && (
        <div className="card" role="alert" style={{ color: 'var(--pink)', padding: 12 }}>
          {actionState.errors.form}
        </div>
      )}
      {actionState.errors?.id && (
        <div className="card" role="alert" style={{ color: 'var(--pink)', padding: 12 }}>
          {actionState.errors.id}
        </div>
      )}
      {actionState.message && (
        <div className="card" role="status" style={{ color: 'var(--mint)', padding: 12 }}>
          {actionState.message}
        </div>
      )}
      {state !== 'archived' && (
        <form action={formAction}>
          <input name="id" readOnly type="hidden" value={id} />
          <button className={publishing ? 'btn btn-holo' : 'btn btn-ghost'} disabled={pending}>
            {pending ? '처리 중' : publishing ? '공개로 전환' : '초안으로 되돌리기'}
          </button>
        </form>
      )}
    </section>
  );
}
