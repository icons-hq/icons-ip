'use client';

import { useActionState } from 'react';
import {
  updateAdminIpIdentityAction,
  type AdminIpIdentityActionState,
} from '@/app/admin/ip-identity-actions';
import type { AdminIpIdentity } from '@/lib/ip-identity';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { SECTION_CARD, SectionHeading } from './sections/SectionLayout';

const EMPTY_STATE: AdminIpIdentityActionState = {};
const CODE = 'rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground';

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
  const inputId = `ip-public-slug-${identity.internalId}`;
  const helpId = `ip-public-slug-help-${identity.internalId}`;

  return (
    <section className={SECTION_CARD}>
      <SectionHeading
        description={<>내부 ID <code className={CODE}>{identity.internalId}</code>는 상품·카드·주문이 가리키는 번호라 바뀌지 않습니다. 공개 URL을 바꾸면 이전 주소는 별칭으로 계속 연결되고 다른 IP가 다시 쓸 수 없습니다.</>}
        title="공개 URL"
      />
      <form action={formAction} className="flex flex-col gap-4" key={formKey}>
        <input name="id" type="hidden" value={identity.internalId} />
        <input name="previousId" type="hidden" value={identity.internalId} />
        <input name="expectedPublicSlug" type="hidden" value={identity.publicSlug} />
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={inputId}>공개 URL</Label>
          <Input
            aria-describedby={helpId}
            aria-invalid={state.errors?.publicSlug ? 'true' : undefined}
            className="max-w-md"
            defaultValue={publicSlug}
            id={inputId}
            maxLength={80}
            name="publicSlug"
            pattern="[a-z0-9][a-z0-9-]*"
            required
          />
          <p className="text-sm text-muted-foreground" id={helpId}>
            /ip/ 뒤에 붙는 주소입니다. 영문 소문자·숫자·하이픈, 최대 80자
          </p>
          {state.errors?.publicSlug ? <p className="text-sm text-destructive" role="alert">{state.errors.publicSlug}</p> : null}
        </div>
        {state.errors?.id ? <p className="text-sm text-destructive" role="alert">{state.errors.id}</p> : null}
        {state.errors?.form ? <p className="text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
        {state.message ? <p aria-live="polite" className="text-sm font-medium text-success" role="status">{state.message}</p> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button disabled={pending} type="submit">
            {pending ? '저장 중' : '공개 URL 저장'}
          </Button>
          <span className="text-sm text-muted-foreground">내부 ID·기존 별칭은 수정하거나 삭제하지 않습니다.</span>
        </div>
      </form>
      <div className="flex flex-col gap-2 border-t pt-4">
        <span className="text-sm leading-snug font-medium">이전 URL 별칭</span>
        {identity.aliases.length ? (
          <ul className="flex flex-wrap gap-2">
            {identity.aliases.map((alias) => <li key={alias}><code className={CODE}>{alias}</code></li>)}
          </ul>
        ) : <span className="text-sm text-muted-foreground">아직 변경된 공개 URL이 없습니다.</span>}
      </div>
    </section>
  );
}
