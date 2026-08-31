'use client';

import { useActionState, useState, type FormEvent } from 'react';
import {
  adjustMemberLoyaltyAction,
  loadAdminMemberDetailAction,
  recalculateMemberLoyaltyAction,
  searchAdminMembersAction,
  suspendAdminMemberAction,
  unsuspendAdminMemberAction,
  type AdminMemberMutationActionState,
} from '@/app/admin/member-actions';
import {
  canModerateAdminMember,
  type AdminMemberDetail,
  type AdminMemberRole,
  type AdminMemberSummary,
} from '@/lib/admin/members';
import { Icon } from '@/components/ui/Icon';
import {
  LOYALTY_GRADES,
  LOYALTY_THRESHOLDS,
  LOYALTY_WINDOW_DAYS,
  loyaltyGradeLabel,
  isLoyaltyGrade,
} from '@/lib/loyalty';
import { ErrorText, InlineNotice, SelectField, TextArea } from '../fields';

const emptyMutationState: AdminMemberMutationActionState = {};
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeZone: 'Asia/Seoul',
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

export function confirmMemberSuspension(event: FormEvent<HTMLFormElement>) {
  const confirmed = window.confirm(
    '이 회원을 정지하면 포스트·댓글 작성, 구매·예매, 카드팩 개봉, 게임 플레이를 새로 진행할 수 없습니다. 계속할까요?',
  );
  if (!confirmed) event.preventDefault();
}

function MemberSuspensionControl({
  actor,
  member,
}: {
  actor: { id: string; role: AdminMemberRole };
  member: AdminMemberDetail;
}) {
  const [suspendState, suspendAction, suspendPending] = useActionState(
    suspendAdminMemberAction,
    emptyMutationState,
  );
  const [unsuspendState, unsuspendAction, unsuspendPending] = useActionState(
    unsuspendAdminMemberAction,
    emptyMutationState,
  );
  const canModerate = canModerateAdminMember({
    actorId: actor.id,
    actorRole: actor.role,
    memberId: member.id,
    memberRole: member.role,
  });

  if (!canModerate) {
    return (
      <div className="card" style={{ borderRadius: 10, padding: 14 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          이 계정은 현재 권한으로 제재할 수 없습니다.
        </span>
      </div>
    );
  }

  if (suspendState.message || unsuspendState.message) {
    const state = suspendState.message ? suspendState : unsuspendState;
    return (
      <div className="card col" style={{ borderRadius: 10, gap: 6, padding: 14 }}>
        <InlineNotice state={state} />
        <span className="muted" style={{ fontSize: 12 }}>
          변경된 상태에서 추가 작업이 필요하면 회원을 다시 검색해 상세를 열어주세요.
        </span>
      </div>
    );
  }

  if (member.suspendedAt) {
    return (
      <div className="card col" style={{ borderRadius: 10, gap: 10, padding: 14 }}>
        <div className="col" style={{ gap: 4 }}>
          <strong style={{ color: 'var(--pink)', fontSize: 14 }}>정지된 계정</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            정지 시각 {new Date(member.suspendedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
          </span>
          <span style={{ fontSize: 13 }}>내부 사유: {member.suspensionReason ?? '기록 없음'}</span>
        </div>
        <form action={unsuspendAction} className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
          <input name="profileId" type="hidden" value={member.id} />
          <button
            className="btn btn-sm admin-field-control"
            disabled={unsuspendPending}
            style={{ minHeight: 44 }}
          >
            <Icon name="check" size={14} /> {unsuspendPending ? '처리 중' : '정지 해제'}
          </button>
          <InlineNotice state={unsuspendState} />
        </form>
      </div>
    );
  }

  return (
    <form
      action={suspendAction}
      className="card col"
      onSubmit={confirmMemberSuspension}
      style={{ borderRadius: 10, gap: 10, padding: 14 }}
    >
      <input name="profileId" type="hidden" value={member.id} />
      <TextArea
        error={suspendState.errors?.reason}
        label="내부 정지 사유"
        maxLength={200}
        name="reason"
        placeholder="운영자가 확인할 내부 사유를 입력하세요"
        required
      />
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
        <button
          className="btn btn-sm admin-field-control"
          disabled={suspendPending}
          style={{ minHeight: 44 }}
        >
          <Icon name="shield" size={14} /> {suspendPending ? '처리 중' : '회원 정지'}
        </button>
        <InlineNotice state={suspendState} />
      </div>
    </form>
  );
}

function ConsentValue({ value }: { value: boolean }) {
  return <strong style={{ color: value ? 'var(--mint)' : 'var(--dim)' }}>{value ? '동의' : '미동의'}</strong>;
}

/*
 * 회원 등급 패널 (S7 #329). 산정의 진실원은 DB 재산정이고, 여기서는 수동
 * 보정(감사 이력 필수)과 트리거 실패 복구용 재산정만 연다. 등급명은 무료
 * Loyalty 어휘를 쓴다 — 멤버십·VIP·티어 금지(CONTEXT.md).
 */
function MemberLoyaltyPanel({ member }: { member: AdminMemberDetail }) {
  const [adjustState, adjustAction, adjustPending] = useActionState(
    adjustMemberLoyaltyAction,
    emptyMutationState,
  );
  const [recalcState, recalcAction, recalcPending] = useActionState(
    recalculateMemberLoyaltyAction,
    emptyMutationState,
  );

  const gradeLabel = isLoyaltyGrade(member.loyaltyGrade)
    ? loyaltyGradeLabel(member.loyaltyGrade)
    : member.loyaltyGrade.toUpperCase();

  return (
    <section className="col" style={{ gap: 10 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
        <strong style={{ fontSize: 14 }}>회원 등급</strong>
        <span className="tag">{gradeLabel}</span>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.7, margin: 0 }}>
        산정 기준: 최근 {LOYALTY_WINDOW_DAYS}일 결제 확정(취소 제외) 주문 총액 —
        SILVER {LOYALTY_THRESHOLDS.silver.toLocaleString('ko-KR')}원 ·
        GOLD {LOYALTY_THRESHOLDS.gold.toLocaleString('ko-KR')}원 ·
        PLATINUM {LOYALTY_THRESHOLDS.platinum.toLocaleString('ko-KR')}원 이상.
        보정 이력은 등급 이력·감사 로그에 남습니다.
      </p>
      <form action={adjustAction} className="col" style={{ gap: 8 }}>
        <input name="profileId" type="hidden" value={member.id} />
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
          <SelectField
            defaultValue={isLoyaltyGrade(member.loyaltyGrade) ? member.loyaltyGrade : 'welcome'}
            error={adjustState.errors?.grade}
            label="보정 등급"
            name="grade"
          >
            {LOYALTY_GRADES.map((grade) => (
              <option key={grade} value={grade}>{loyaltyGradeLabel(grade)}</option>
            ))}
          </SelectField>
        </div>
        <TextArea
          error={adjustState.errors?.note}
          label="보정 사유 (오프라인 실적·분쟁 대응 등)"
          name="note"
          placeholder="예: 오프라인 팝업 구매 실적 반영"
          required
        />
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
          <button className="btn btn-sm admin-field-control" disabled={adjustPending} style={{ minHeight: 40 }}>
            <Icon name="check" size={14} /> {adjustPending ? '보정 중' : '등급 보정'}
          </button>
        </div>
        <InlineNotice state={adjustState} />
      </form>
      <form action={recalcAction} className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
        <input name="profileId" type="hidden" value={member.id} />
        <button className="btn btn-sm admin-field-control" disabled={recalcPending} style={{ minHeight: 40 }}>
          <Icon name="swap" size={14} /> {recalcPending ? '재산정 중' : '실적으로 재산정'}
        </button>
        <InlineNotice state={recalcState} />
      </form>
    </section>
  );
}

function MemberDetail({
  actor,
  member,
}: {
  actor: { id: string; role: AdminMemberRole };
  member: AdminMemberDetail;
}) {
  const counts = [
    ['굿즈 주문', member.goodsOrderCount],
    ['티켓 예매', member.ticketOrderCount],
    ['제출한 신고', member.submittedReportCount],
    ['받은 신고', member.receivedReportCount],
  ] as const;

  return (
    <article className="card col" style={{ borderRadius: 10, gap: 16, padding: 18 }}>
      <div className="between" style={{ alignItems: 'start', flexWrap: 'wrap', gap: 12 }}>
        <div className="col" style={{ gap: 5, minWidth: 0 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
            <strong style={{ fontSize: 17 }}>@{member.nickname}</strong>
            <span className="tag">{member.role}</span>
            {member.suspendedAt && <span className="tag" style={{ color: 'var(--pink)' }}>정지</span>}
          </div>
          <span className="mono" style={{ fontSize: 13 }}>{member.email}</span>
          <span className="faint mono" style={{ fontSize: 11 }}>
            가입 {formatDate(member.createdAt)}
          </span>
        </div>
      </div>

      <section className="col" style={{ gap: 8 }}>
        <strong style={{ fontSize: 14 }}>현재 동의 상태</strong>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, justifyContent: 'flex-start' }}>
          <span className="muted" style={{ fontSize: 13 }}>이용약관 <ConsentValue value={member.consents.terms} /></span>
          <span className="muted" style={{ fontSize: 13 }}>개인정보 <ConsentValue value={member.consents.privacy} /></span>
          <span className="muted" style={{ fontSize: 13 }}>마케팅 <ConsentValue value={member.consents.marketing} /></span>
        </div>
      </section>

      <section className="col" style={{ gap: 8 }}>
        <strong style={{ fontSize: 14 }}>운영 집계</strong>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
          {counts.map(([label, count]) => (
            <div key={label} className="card col" style={{ borderRadius: 10, gap: 4, padding: 12 }}>
              <span className="muted" style={{ fontSize: 12 }}>{label}</span>
              <strong className="mono" style={{ fontSize: 18 }}>{count}</strong>
            </div>
          ))}
        </div>
      </section>

      <MemberLoyaltyPanel key={`loyalty-${member.id}:${member.loyaltyGrade}`} member={member} />

      <MemberSuspensionControl
        actor={actor}
        key={`${member.id}:${member.suspendedAt ?? 'active'}`}
        member={member}
      />
    </article>
  );
}

export function MembersSection({
  actor,
  initialMembers,
}: {
  actor: { id: string; role: AdminMemberRole };
  initialMembers: AdminMemberSummary[];
}) {
  const [searchState, searchAction, searchPending] = useActionState(searchAdminMembersAction, {
    members: initialMembers,
    query: '',
  });
  const [detailState, detailAction, detailPending] = useActionState(loadAdminMemberDetailAction, {
    member: null,
  });
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    detailState.member?.id ?? null,
  );
  const activeDetail = !searchPending
    && !detailPending
    && detailState.member?.id === selectedProfileId
    && searchState.members.some((member) => member.id === selectedProfileId)
    ? detailState.member
    : null;

  return (
    <section className="col" style={{ gap: 14 }}>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        목록의 이메일은 마스킹됩니다. 전체 이메일과 운영 정보는 상세 조회 시에만 표시됩니다.
      </p>
      <form
        action={searchAction}
        className="card col"
        onSubmit={() => setSelectedProfileId(null)}
        style={{ borderRadius: 10, gap: 8, padding: 14 }}
      >
        <label className="col" style={{ gap: 7 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>회원 검색</span>
          <div className="row" style={{ gap: 8 }}>
            <input
              aria-describedby={searchState.errors?.query ? 'member-query-error' : undefined}
              aria-invalid={Boolean(searchState.errors?.query)}
              className="admin-field-control"
              defaultValue={searchState.query}
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
            <button className="btn btn-sm admin-field-control" disabled={searchPending} style={{ minHeight: 44 }}>
              <Icon name="search" size={14} /> {searchPending ? '검색 중' : '검색'}
            </button>
          </div>
        </label>
        <ErrorText id="member-query-error">{searchState.errors?.query}</ErrorText>
        <InlineNotice state={searchState} />
      </form>

      <div className="col" style={{ gap: 8 }}>
        {searchState.members.map((member) => (
          <article key={member.id} className="card between" style={{ borderRadius: 10, flexWrap: 'wrap', gap: 12, padding: 14 }}>
            <div className="col" style={{ gap: 4, minWidth: 0 }}>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
                <strong style={{ fontSize: 15 }}>@{member.nickname}</strong>
                <span className="tag">{member.role}</span>
                {member.suspendedAt && <span className="tag" style={{ color: 'var(--pink)' }}>정지</span>}
              </div>
              <span className="mono" style={{ fontSize: 12 }}>{member.maskedEmail}</span>
              <span className="faint mono" style={{ fontSize: 11 }}>가입 {formatDate(member.createdAt)}</span>
            </div>
            <form action={detailAction} onSubmit={() => setSelectedProfileId(member.id)}>
              <input name="profileId" type="hidden" value={member.id} />
              <button className="btn btn-sm admin-field-control" disabled={detailPending} style={{ minHeight: 44 }}>
                <Icon name="user" size={14} /> {detailPending ? '불러오는 중' : '상세 보기'}
              </button>
            </form>
          </article>
        ))}
        {!searchState.members.length && (
          <div className="card" style={{ borderRadius: 10, padding: 18 }}>
            <div style={{ fontWeight: 700 }}>검색 결과가 없습니다.</div>
            <p className="muted" style={{ marginTop: 6 }}>다른 이메일 또는 닉네임으로 검색해주세요.</p>
          </div>
        )}
      </div>

      <InlineNotice state={detailState} />
      {activeDetail && <MemberDetail actor={actor} member={activeDetail} />}
    </section>
  );
}
