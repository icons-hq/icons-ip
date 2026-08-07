'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  grantAdminDrawTicketsAction,
  type AdminDrawTicketGrantActionState,
} from '@/app/admin/reward-grant-actions';
import { searchAdminMembersAction } from '@/app/admin/member-actions';
import type { AdminCardPoolRecord } from '@/lib/admin/catalog.server';
import {
  DRAW_TICKET_GRANT_MAX_QUANTITY,
  type AdminDrawTicketGrantRecord,
} from '@/lib/admin/draw-ticket-grants';
import type { AdminMemberSummary } from '@/lib/admin/members';
import { Icon } from '@/components/ui/Icon';
import { ErrorText, Field, InlineNotice, SelectField, TextArea } from '../fields';
import { getRewardPolicyPoolOptions } from './RewardPolicySection';

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

  return (
    <section className="col" style={{ gap: 14 }}>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        특정 회원에게 카드팩을 직접 발급합니다. 사유와 실행자가 감사 로그에 남고, 같은 요청을
        두 번 보내도 중복 발급되지 않습니다. 자동 발급(주문 결제 완료)과 집계가 분리됩니다.
      </p>

      {!poolOptions.length ? (
        <div className="card col" role="status" style={{ borderRadius: 10, gap: 6, padding: 18 }}>
          <strong>발급할 수 있는 카드풀이 없습니다.</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            카드풀 관리에서 운영 기간과 등급별 확률을 채우고 카드를 바인딩한 뒤 다시 시도해주세요.
          </span>
        </div>
      ) : (
        <>
          <MemberPicker
            action={searchAction}
            members={searchState.members}
            onSelect={setSelected}
            pending={searchPending}
            query={searchState.query}
            queryError={searchState.errors?.query}
            selectedId={selected?.id ?? null}
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

      <GrantHistory grants={grants} />
    </section>
  );
}

function MemberPicker({
  action,
  members,
  onSelect,
  pending,
  query,
  queryError,
  selectedId,
}: {
  action: (formData: FormData) => void;
  members: AdminMemberSummary[];
  onSelect: (member: AdminMemberSummary | null) => void;
  pending: boolean;
  query: string;
  queryError?: string;
  selectedId: string | null;
}) {
  return (
    <div className="col" style={{ gap: 8 }}>
      <form
        action={action}
        className="card col"
        onSubmit={() => onSelect(null)}
        style={{ borderRadius: 10, gap: 8, padding: 14 }}
      >
        <label className="col" style={{ gap: 7 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>발급 대상 검색</span>
          <div className="row" style={{ gap: 8 }}>
            <input
              aria-describedby={queryError ? 'grant-query-error' : undefined}
              aria-invalid={Boolean(queryError)}
              className="admin-field-control"
              defaultValue={query}
              maxLength={100}
              name="query"
              placeholder="이메일 또는 닉네임"
              style={{
                background: 'rgba(255,255,255,.045)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                color: 'var(--text)',
                fontFamily: 'inherit',
                fontSize: 14,
                minHeight: 44,
                outline: 'none',
                padding: '0 12px',
                width: '100%',
              }}
            />
            <button className="btn btn-sm admin-field-control" disabled={pending} style={{ minHeight: 44 }}>
              <Icon name="search" size={14} /> {pending ? '검색 중' : '검색'}
            </button>
          </div>
        </label>
        <ErrorText id="grant-query-error">{queryError}</ErrorText>
      </form>

      {members.map((member) => (
        <article key={member.id} className="card between" style={{ borderRadius: 10, flexWrap: 'wrap', gap: 12, padding: 14 }}>
          <div className="col" style={{ gap: 4, minWidth: 0 }}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
              <strong style={{ fontSize: 15 }}>@{member.nickname}</strong>
              {member.suspendedAt && <span className="tag" style={{ color: 'var(--pink)' }}>정지</span>}
            </div>
            <span className="mono" style={{ fontSize: 12 }}>{member.maskedEmail}</span>
          </div>
          <button
            aria-current={selectedId === member.id ? 'true' : undefined}
            className={selectedId === member.id ? 'btn btn-sm btn-holo' : 'btn btn-sm'}
            disabled={Boolean(member.suspendedAt)}
            onClick={() => onSelect(member)}
            style={{ minHeight: 44 }}
            type="button"
          >
            <Icon name="user" size={14} /> {selectedId === member.id ? '선택됨' : '발급 대상으로 선택'}
          </button>
        </article>
      ))}
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
      <div className="card" role="status" style={{ borderRadius: 10, padding: 18 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          발급 대상을 검색해 선택하면 발급 폼이 열립니다.
        </span>
      </div>
    );
  }

  return (
    <form action={action} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <input name="operationId" type="hidden" value={operationId} />
      <input name="profileId" type="hidden" value={selected.id} />
      <div className="col" style={{ gap: 4 }}>
        <strong>@{selected.nickname} 에게 발급</strong>
        <span className="mono muted" style={{ fontSize: 12 }}>{selected.maskedEmail}</span>
      </div>
      <div className="admin-form-grid">
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
      </div>
      <TextArea
        error={state.errors?.reason}
        label="발급 사유"
        maxLength={200}
        name="reason"
        placeholder="예: 카드풀 준비 전 결제한 초기 구매자 소급 발급"
        required
      />
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
        <button className="btn btn-holo" disabled={pending} style={{ minWidth: 150 }}>
          <Icon name="check" size={15} /> {pending ? '발급 중' : '카드팩 발급'}
        </button>
        <InlineNotice state={state} />
      </div>
    </form>
  );
}

function GrantHistory({ grants }: { grants: AdminDrawTicketGrantRecord[] }) {
  return (
    <section aria-labelledby="draw-ticket-grant-history-title" className="col" style={{ gap: 8 }}>
      <strong id="draw-ticket-grant-history-title" style={{ fontSize: 14 }}>최근 수동 발급</strong>
      {!grants.length && (
        <div className="card" role="status" style={{ borderRadius: 10, padding: 18 }}>
          <span className="muted" style={{ fontSize: 13 }}>수동 발급 이력이 없습니다.</span>
        </div>
      )}
      {grants.map((grant) => (
        <article key={grant.operationId} className="card col" style={{ borderRadius: 10, gap: 6, padding: 14 }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ fontSize: 14 }}>
              @{grant.recipientNickname} · 카드팩 {grant.quantity.toLocaleString('ko-KR')}개
            </strong>
            <span className="faint mono" style={{ fontSize: 11 }}>{formatGrantedAt(grant.grantedAt)}</span>
          </div>
          <span className="mono muted" style={{ fontSize: 12 }}>
            {grant.poolName} · 개봉 {grant.openedCount.toLocaleString('ko-KR')} · 회수 {grant.revokedCount.toLocaleString('ko-KR')}
          </span>
          <span style={{ fontSize: 13 }}>사유: {grant.reason}</span>
          <span className="faint mono" style={{ fontSize: 11 }}>실행자 @{grant.actorNickname}</span>
        </article>
      ))}
    </section>
  );
}
