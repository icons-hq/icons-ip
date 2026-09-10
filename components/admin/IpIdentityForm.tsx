'use client';

import { useActionState } from 'react';
import {
  updateAdminIpIdentityAction,
  type AdminIpIdentityActionState,
} from '@/app/admin/ip-identity-actions';
import type { AdminIpIdentity } from '@/lib/ip-identity';

const EMPTY_STATE: AdminIpIdentityActionState = {};

function valueFromState(
  state: AdminIpIdentityActionState,
  key: string,
  fallback: string,
): string {
  return state.values && Object.hasOwn(state.values, key) ? state.values[key] : fallback;
}

export function IpIdentityForm({ identity }: { identity: AdminIpIdentity }) {
  const [state, formAction, pending] = useActionState(updateAdminIpIdentityAction, EMPTY_STATE);
  const publicSlug = valueFromState(state, 'publicSlug', identity.publicSlug);
  const formKey = `${identity.internalId}:${state.attempt ?? 0}`;

  return (
    <section className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div>
        <span className="eyebrow">PUBLIC IDENTITY</span>
        <h2 style={{ fontSize: 18, margin: '6px 0 0' }}>공개 URL</h2>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        내부 참조 ID <code>{identity.internalId}</code>는 유지됩니다. URL을 바꾸면 이전 주소는 별칭으로 계속 연결되고 다시 사용할 수 없습니다.
      </p>
      <form action={formAction} className="col" key={formKey} style={{ gap: 12 }}>
        <input name="id" type="hidden" value={identity.internalId} />
        <input name="previousId" type="hidden" value={identity.internalId} />
        <input name="expectedPublicSlug" type="hidden" value={identity.publicSlug} />
        <label className="col" htmlFor={`ip-public-slug-${identity.internalId}`} style={{ gap: 7 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>공개 슬러그</span>
          <input
            aria-describedby={`ip-public-slug-help-${identity.internalId}`}
            aria-invalid={state.errors?.publicSlug ? 'true' : undefined}
            className="admin-field-control"
            defaultValue={publicSlug}
            id={`ip-public-slug-${identity.internalId}`}
            maxLength={80}
            name="publicSlug"
            pattern="[a-z0-9][a-z0-9-]*"
            required
          />
          <span className="muted" id={`ip-public-slug-help-${identity.internalId}`} style={{ fontSize: 12 }}>
            영문 소문자·숫자·하이픈, 최대 80자
          </span>
          {state.errors?.publicSlug ? <span role="alert" style={{ color: 'var(--pink)', fontSize: 12 }}>{state.errors.publicSlug}</span> : null}
        </label>
        {state.errors?.id ? <p role="alert" style={{ color: 'var(--pink)', fontSize: 12, margin: 0 }}>{state.errors.id}</p> : null}
        {state.errors?.form ? <p role="alert" style={{ color: 'var(--pink)', fontSize: 12, margin: 0 }}>{state.errors.form}</p> : null}
        {state.message ? <p aria-live="polite" role="status" style={{ color: 'var(--mint)', fontSize: 12, margin: 0 }}>{state.message}</p> : null}
        <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <button className="btn btn-holo" disabled={pending} type="submit">
            {pending ? '저장 중' : '공개 URL 저장'}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>내부 ID·기존 별칭은 수정하거나 삭제하지 않습니다.</span>
        </div>
      </form>
      <div className="col" style={{ gap: 7 }}>
        <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>이전 URL 별칭</span>
        {identity.aliases.length ? (
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {identity.aliases.map((alias) => <li key={alias}><code>{alias}</code></li>)}
          </ul>
        ) : <span className="muted" style={{ fontSize: 12 }}>아직 변경된 공개 URL이 없습니다.</span>}
      </div>
    </section>
  );
}
