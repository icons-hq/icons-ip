'use client';

import { useActionState } from 'react';
import { setIpVisibilityAction } from '@/app/admin/category-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { SeededForm } from '@/components/admin/form-seed';
import { Field, InlineNotice } from '../fields';

const emptyState: AdminCatalogActionState = {};

/*
 * IP 노출/숨김 (현업 슬라이스 5 · 「노출/미노출 설정 화면 없음」).
 *
 * **보관이 아니다.** 보관은 하위 굿즈가 살아 있으면 막힌다 — 그래서 「굿즈는 그대로 두고
 * 목록에서만 잠시 내린다」를 할 방법이 없었다. 이 카드가 그 자리다.
 *
 * **직접 링크는 살아 있다.** 숨김은 목록에서 빼는 것이지 없애는 것이 아니다 — 이미 공유된
 * 링크가 죽으면 그게 더 큰 사고다. 화면이 그 사실을 직접 말해야 운영자가 「내렸으니 안
 * 보이겠지」로 오해하지 않는다.
 */
export function IpVisibilityPanel({
  hiddenAt,
  id,
}: {
  hiddenAt: string | null;
  id: string;
}) {
  const [state, action, pending] = useActionState(setIpVisibilityAction, emptyState);
  const hidden = hiddenAt !== null;

  return (
    <section aria-labelledby={`ip-visibility-${id}`} className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
      <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <span className="eyebrow">VISIBILITY</span>
          <h2 id={`ip-visibility-${id}`} style={{ fontSize: 18, margin: '6px 0 0' }}>노출 상태</h2>
        </div>
        <span className="admin-badge" data-sale-state={hidden ? 'hidden' : 'selling'}>
          {hidden ? '숨김' : '노출'}
        </span>
      </div>

      <SeededForm values={state.values} action={action} className="col" style={{ gap: 10 }}>
        <input name="ipId" type="hidden" value={id} />
        <input name="visible" type="hidden" value={hidden ? 'true' : 'false'} />
        {/* 끄는 쪽에만 사유를 받는다 — 되돌릴 때 왜 내렸는지가 남아야 한다. */}
        {hidden ? null : (
          <Field
            error={state.errors?.reason}
            label="숨김 사유 (필수)"
            name="reason"
            placeholder="라이선스 검토, 시즌 종료 등"
          />
        )}
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          숨기면 스토어 IP 목록에서 빠집니다. <strong>직접 링크와 하위 굿즈는 그대로</strong> 살아
          있습니다 — 이미 공유된 주소가 죽지 않도록 한 것입니다. 완전히 내리려면 보관을 쓰세요.
        </p>
        <InlineNotice state={state} />
        <button className="btn btn-sm" disabled={pending} style={{ justifySelf: 'start' }} type="submit">
          {pending ? '적용 중' : hidden ? '다시 노출하기' : '숨기기'}
        </button>
      </SeededForm>
    </section>
  );
}
