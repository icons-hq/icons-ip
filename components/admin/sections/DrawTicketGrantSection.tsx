'use client';

import { AdminFormGrid } from '@/components/admin/console/AdminKit';
import { useActionState, useMemo, useState } from 'react';
import {
  grantAdminDrawTicketsAction,
  type AdminDrawTicketGrantActionState,
} from '@/app/admin/reward-grant-actions';
import {
  searchAdminMembersAction,
  type AdminMemberSearchActionState,
} from '@/app/admin/member-actions';
import type { AdminCardPoolRecord } from '@/lib/admin/catalog.server';
import {
  DRAW_TICKET_GRANT_MAX_QUANTITY,
  type AdminDrawTicketGrantRecord,
} from '@/lib/admin/draw-ticket-grants';
import type { AdminMemberSummary } from '@/lib/admin/members';
import { Check, Search, UserCheck, UserRound } from 'lucide-react';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { ErrorText, Field, InlineNotice, SelectField, TextArea } from '../fields';
import { getRewardPolicyPoolOptions } from './RewardPolicySection';
import { SECTION_CARD, SECTION_NOTE, SectionHeading } from './SectionLayout';

/* 수동 카드팩(뽑기권) 발급 콘솔(#185).
 * 발급 정책(자동)과 화면을 나눈 이유는 감사 단위가 다르기 때문이다 — 정책은 조건을 세우고,
 * 여기서는 특정 회원에게 사유를 적어 지금 발급한다.
 * 홍실 퀘스트처럼 카드풀이 0인 IP만 있는 상태(계획 D3)에서도 화면이 깨지지 않아야 한다. */

const emptyGrantState: AdminDrawTicketGrantActionState = {};

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});

function formatGrantedAt(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? '시각 기록 없음' : dateTimeFormatter.format(new Date(parsed));
}

export function DrawTicketGrantSection({
  draftOperationId,
  grants,
  pools,
}: {
  draftOperationId: string;
  grants: AdminDrawTicketGrantRecord[];
  pools: AdminCardPoolRecord[];
}) {
  const poolOptions = useMemo(() => getRewardPolicyPoolOptions(pools, null), [pools]);
  const [searchState, searchAction, searchPending] = useActionState(searchAdminMembersAction, {
    members: [] as AdminMemberSummary[],
    query: '',
  });
  const [grantState, grantAction, grantPending] = useActionState(
    grantAdminDrawTicketsAction,
    emptyGrantState,
  );
  const [selected, setSelected] = useState<AdminMemberSummary | null>(null);

  /* 넓은 화면에서는 왼쪽에 대상 검색 → 발급 폼, 오른쪽에 최근 수동 발급 이력을 둔다(읽는 순서는 같다). */
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        특정 회원에게 카드팩을 직접 발급합니다. 사유와 실행자가 감사 로그에 남고, 같은 요청을
        두 번 보내도 중복 발급되지 않습니다. 자동 발급(주문 결제 완료)과 집계가 분리됩니다.
      </p>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {!poolOptions.length ? (
            <div className={`${SECTION_NOTE} flex flex-col gap-1`} role="status">
              <strong className="font-medium text-foreground">발급할 수 있는 카드풀이 없습니다.</strong>
              <span>
                카드풀 관리에서 운영 기간과 등급별 확률을 채우고 카드를 바인딩한 뒤 다시 시도해주세요.
              </span>
            </div>
          ) : (
            <>
              <MemberPicker
                action={searchAction}
                onSelect={setSelected}
                pending={searchPending}
                selectedId={selected?.id ?? null}
                state={searchState}
              />
              <GrantForm
                action={grantAction}
                key={grantState.nextOperationId ?? draftOperationId}
                operationId={grantState.nextOperationId ?? draftOperationId}
                pending={grantPending}
                poolOptions={poolOptions}
                selected={selected}
                state={grantState}
              />
            </>
          )}
        </div>

        <GrantHistory grants={grants} />
      </div>
    </section>
  );
}

/*
 * 검색 상태를 통째로 받는다. 필드별로 쪼개 받으면 errors.form 처럼 새로 생긴
 * 실패 경로가 조용히 버려진다 — RPC 가 죽어 빈 목록이 돌아온 것과 "해당 회원이
 * 없다"가 화면에서 같아 보이면 운영자가 소급 발급을 포기한다.
 */
function MemberPicker({
  action,
  onSelect,
  pending,
  selectedId,
  state,
}: {
  action: (formData: FormData) => void;
  onSelect: (member: AdminMemberSummary | null) => void;
  pending: boolean;
  selectedId: string | null;
  state: AdminMemberSearchActionState;
}) {
  const queryError = state.errors?.query;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <form
        action={action}
        className={SECTION_CARD}
        onSubmit={() => onSelect(null)}
      >
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="grant-query">발급 대상 검색</Label>
          <div className="flex gap-2">
            <Input
              aria-describedby={queryError ? 'grant-query-error' : undefined}
              aria-invalid={Boolean(queryError)}
              defaultValue={state.query}
              id="grant-query"
              maxLength={100}
              name="query"
              placeholder="이메일 또는 닉네임"
            />
            <Button disabled={pending} type="submit">
              <Search aria-hidden="true" /> {pending ? '검색 중' : '검색'}
            </Button>
          </div>
        </div>
        <ErrorText id="grant-query-error">{queryError}</ErrorText>
        <InlineNotice state={state} />
      </form>

      {state.members.length ? (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {state.members.map((member) => (
            <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" key={member.id}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium break-all">@{member.nickname}</span>
                  {member.suspendedAt && <Badge variant="destructive">정지</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">{member.maskedEmail}</span>
              </div>
              <Button
                aria-current={selectedId === member.id ? 'true' : undefined}
                disabled={Boolean(member.suspendedAt)}
                onClick={() => onSelect(member)}
                size="sm"
                type="button"
                variant={selectedId === member.id ? 'default' : 'outline'}
              >
                {selectedId === member.id ? <UserCheck aria-hidden="true" /> : <UserRound aria-hidden="true" />} {selectedId === member.id ? '선택됨' : '발급 대상으로 선택'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function GrantForm({
  action,
  operationId,
  pending,
  poolOptions,
  selected,
  state,
}: {
  action: (formData: FormData) => void;
  operationId: string;
  pending: boolean;
  poolOptions: AdminCardPoolRecord[];
  selected: AdminMemberSummary | null;
  state: AdminDrawTicketGrantActionState;
}) {
  if (!selected) {
    return (
      <div className={SECTION_NOTE} role="status">
        발급 대상을 검색해 선택하면 발급 폼이 열립니다.
      </div>
    );
  }

  return (
    <form action={action} className={SECTION_CARD}>
      <input name="operationId" type="hidden" value={operationId} />
      <input name="profileId" type="hidden" value={selected.id} />
      <SectionHeading description={selected.maskedEmail} title={`@${selected.nickname} 에게 발급`} />
      <AdminFormGrid>
        <SelectField
          defaultValue={poolOptions[0]?.id ?? ''}
          error={state.errors?.poolId}
          label="발급 카드풀"
          name="poolId"
          required
        >
          {poolOptions.map((pool) => (
            <option key={pool.id} value={pool.id}>{pool.name}</option>
          ))}
        </SelectField>
        <Field
          defaultValue={1}
          error={state.errors?.quantity}
          label={`발급 수량 (최대 ${DRAW_TICKET_GRANT_MAX_QUANTITY})`}
          max={DRAW_TICKET_GRANT_MAX_QUANTITY}
          min={1}
          name="quantity"
          required
          step={1}
          type="number"
        />
      </AdminFormGrid>
      <TextArea
        error={state.errors?.reason}
        label="발급 사유"
        maxLength={200}
        name="reason"
        placeholder="예: 카드풀 준비 전 결제한 초기 구매자 소급 발급"
        required
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button className="min-w-36" disabled={pending} type="submit">
          <Check aria-hidden="true" /> {pending ? '발급 중' : '카드팩 발급'}
        </Button>
        {/* 발급 성공·실패를 알린다. 이게 없으면 RPC 실패가 아무 표시 없이 삼켜진다. */}
        <InlineNotice state={state} />
      </div>
    </form>
  );
}

function GrantHistory({ grants }: { grants: AdminDrawTicketGrantRecord[] }) {
  return (
    <section aria-labelledby="draw-ticket-grant-history-title" className={SECTION_CARD}>
      <SectionHeading id="draw-ticket-grant-history-title" title="최근 수동 발급" />
      {!grants.length && (
        <p className="py-6 text-center text-sm text-muted-foreground" role="status">수동 발급 이력이 없습니다.</p>
      )}
      {grants.length ? (
        <ol className="flex flex-col divide-y rounded-lg border">
          {grants.map((grant) => (
            <li className="flex min-w-0 flex-col gap-1 px-3 py-2.5" key={grant.operationId}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <span className="text-sm font-medium break-all">
                  @{grant.recipientNickname} · 카드팩 {grant.quantity.toLocaleString('ko-KR')}개
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{formatGrantedAt(grant.grantedAt)}</span>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {grant.poolName} · 개봉 {grant.openedCount.toLocaleString('ko-KR')} · 회수 {grant.revokedCount.toLocaleString('ko-KR')}
              </span>
              <span className="text-sm break-words">사유: {grant.reason}</span>
              <span className="text-xs text-muted-foreground">실행자 @{grant.actorNickname}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
