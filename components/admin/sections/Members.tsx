'use client';

import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import Link from 'next/link';
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
import { Check, RefreshCw, Search, ShieldBan, User } from 'lucide-react';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import {
  LOYALTY_GRADES,
  isLoyaltyGrade,
  loyaltyBasisSummary,
  loyaltyGradeLabel,
} from '@/lib/loyalty';
import { ErrorText, InlineNotice, SelectField, TextArea } from '../fields';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, ConsoleFilterActions, ConsoleFilterField } from '../console/ConsoleFilterPanel';
import { ConsoleListCard } from '../console/ConsoleListCard';

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

/* 터치 화면에서는 운영 동작을 44px 이상으로 둔다(마우스에서는 kit 기본 크기). */
const TOUCH_TARGET_CLASS = 'pointer-coarse:min-h-11';

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
    memberId: member.id,
    moderation: member.moderation,
  });

  if (!canModerate) {
    return (
      <div className="rounded-lg border bg-muted/40 px-4 py-3">
        <span className="text-sm text-muted-foreground">
          이 계정은 현재 권한으로 제재할 수 없습니다.
        </span>
      </div>
    );
  }

  if (suspendState.message || unsuspendState.message) {
    const state = suspendState.message ? suspendState : unsuspendState;
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 px-4 py-3">
        <InlineNotice state={state} />
        <span className="text-xs text-muted-foreground">
          변경된 상태에서 추가 작업이 필요하면 회원을 다시 검색해 상세를 열어주세요.
        </span>
      </div>
    );
  }

  if (member.suspendedAt) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex flex-col gap-1">
          <strong className="text-sm font-semibold text-destructive">정지된 계정</strong>
          <span className="text-xs text-muted-foreground tabular-nums">
            정지 시각 {new Date(member.suspendedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
          </span>
          <span className="text-sm wrap-anywhere">내부 사유: {member.suspensionReason ?? '기록 없음'}</span>
        </div>
        <form action={unsuspendAction} className="flex flex-wrap items-center gap-2">
          <input name="profileId" type="hidden" value={member.id} />
          <Button className={TOUCH_TARGET_CLASS} disabled={unsuspendPending} type="submit" variant="outline">
            <Check aria-hidden="true" /> {unsuspendPending ? '처리 중' : '정지 해제'}
          </Button>
          <InlineNotice state={unsuspendState} />
        </form>
      </div>
    );
  }

  return (
    <form
      action={suspendAction}
      className="flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={confirmMemberSuspension}
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
      <div className="flex flex-wrap items-center gap-2">
        <Button className={TOUCH_TARGET_CLASS} disabled={suspendPending} type="submit" variant="destructive">
          <ShieldBan aria-hidden="true" /> {suspendPending ? '처리 중' : '회원 정지'}
        </Button>
        <InlineNotice state={suspendState} />
      </div>
    </form>
  );
}

function ConsentValue({ value }: { value: boolean }) {
  return <strong className={value ? 'font-semibold text-[var(--wc-success)]' : 'font-semibold text-muted-foreground'}>{value ? '동의' : '미동의'}</strong>;
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
    <section className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm font-semibold text-foreground">회원 등급</strong>
        <Badge variant="secondary">{gradeLabel}</Badge>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {loyaltyBasisSummary()} 보정 이력은 등급 이력·감사 로그에 남습니다.
      </p>
      <form action={adjustAction} className="flex flex-col gap-3">
        <input name="profileId" type="hidden" value={member.id} />
        <div className="max-w-xs">
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
        <Button className={`self-start ${TOUCH_TARGET_CLASS}`} disabled={adjustPending} type="submit">
          <Check aria-hidden="true" /> {adjustPending ? '보정 중' : '등급 보정'}
        </Button>
        <InlineNotice state={adjustState} />
      </form>
      <form action={recalcAction} className="flex flex-wrap items-center gap-2">
        <input name="profileId" type="hidden" value={member.id} />
        <Button className={TOUCH_TARGET_CLASS} disabled={recalcPending} type="submit" variant="outline">
          <RefreshCw aria-hidden="true" /> {recalcPending ? '재산정 중' : '실적으로 재산정'}
        </Button>
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
    [adminGoodsCopy('굿즈 주문'), member.goodsOrderCount],
    ['티켓 예매', member.ticketOrderCount],
    ['제출한 신고', member.submittedReportCount],
    ['받은 신고', member.receivedReportCount],
  ] as const;

  return (
    <article className="flex min-w-0 flex-col gap-5 rounded-xl border bg-card p-4 text-card-foreground sm:p-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-base font-semibold text-foreground">@{member.nickname}</strong>
          <Badge variant="outline">{member.role}</Badge>
          {member.suspendedAt && <Badge variant="destructive">정지</Badge>}
        </div>
        <span className="text-sm tabular-nums wrap-anywhere">{member.email}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          가입 {formatDate(member.createdAt)}
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <strong className="text-sm font-semibold text-foreground">현재 동의 상태</strong>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>이용약관 <ConsentValue value={member.consents.terms} /></span>
          <span>개인정보 <ConsentValue value={member.consents.privacy} /></span>
          <span>마케팅 <ConsentValue value={member.consents.marketing} /></span>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <strong className="text-sm font-semibold text-foreground">운영 집계</strong>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {counts.map(([label, count]) => (
            <div key={label} className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3">
              <span className="text-xs text-muted-foreground">{label}</span>
              <strong className="text-lg font-semibold text-foreground tabular-nums">{count}</strong>
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
    <section className="flex min-w-0 flex-col gap-4" data-members-section="">
      <p className="text-sm text-muted-foreground">
        목록의 이메일은 마스킹됩니다. 전체 이메일과 운영 정보는 상세 조회 시에만 표시됩니다.
      </p>
      <form
        action={searchAction}
        className={CONSOLE_FILTER_CARD_CLASS}
        onSubmit={() => setSelectedProfileId(null)}
      >
        <div className={CONSOLE_FILTER_FIELDS_CLASS}>
          <ConsoleFilterField className="min-w-[min(100%,20rem)] flex-1" htmlFor="member-query" label="회원 검색">
            <Input
              aria-describedby={searchState.errors?.query ? 'member-query-error' : undefined}
              aria-invalid={Boolean(searchState.errors?.query)}
              className={TOUCH_TARGET_CLASS}
              defaultValue={searchState.query}
              id="member-query"
              maxLength={100}
              name="query"
              placeholder="이메일 또는 닉네임"
            />
            <ErrorText id="member-query-error">{searchState.errors?.query}</ErrorText>
          </ConsoleFilterField>
        </div>
        <InlineNotice state={searchState} />
        {/* 조회 카드 바닥 줄 [초기화][검색]. 초기화는 검색어를 비우고 처음 목록을 다시 읽는다. */}
        <ConsoleFilterActions>
          <Button
            className={TOUCH_TARGET_CLASS}
            disabled={searchPending}
            onClick={(event) => {
              const form = event.currentTarget.form;
              const query = form?.elements.namedItem('query');
              if (query instanceof HTMLInputElement) query.value = '';
              form?.requestSubmit();
            }}
            type="button"
            variant="outline"
          >
            초기화
          </Button>
          <Button className={TOUCH_TARGET_CLASS} disabled={searchPending} type="submit">
            <Search aria-hidden="true" /> {searchPending ? '검색 중' : '검색'}
          </Button>
        </ConsoleFilterActions>
      </form>

      <ConsoleListCard aria-label="회원 검색 결과">
        {searchState.members.length ? <div className="flex flex-col divide-y">
        {searchState.members.map((member) => (
          <article key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm font-semibold text-foreground">@{member.nickname}</strong>
                <Badge variant="outline">{member.role}</Badge>
                {member.suspendedAt && <Badge variant="destructive">정지</Badge>}
              </div>
              <span className="text-xs tabular-nums">{member.maskedEmail}</span>
              <span className="text-xs text-muted-foreground tabular-nums">가입 {formatDate(member.createdAt)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className={`${buttonVariants({ size: 'sm', variant: 'outline' })} ${TOUCH_TARGET_CLASS}`} data-slot="button" href={`/admin/customers/${member.id}`}>고객 상세 열기</Link>
              <form action={detailAction} onSubmit={() => setSelectedProfileId(member.id)}>
                <input name="profileId" type="hidden" value={member.id} />
                <Button className={TOUCH_TARGET_CLASS} disabled={detailPending} size="sm" type="submit">
                  <User aria-hidden="true" /> {detailPending ? '불러오는 중' : '상세 보기'}
                </Button>
              </form>
            </div>
          </article>
        ))}
        </div> : (
          <div className="py-10 text-center">
            <div className="text-sm font-semibold">검색 결과가 없습니다.</div>
            <p className="mt-1.5 text-sm text-muted-foreground">다른 이메일 또는 닉네임으로 검색해주세요.</p>
          </div>
        )}
      </ConsoleListCard>

      <InlineNotice state={detailState} />
      {activeDetail && <MemberDetail actor={actor} member={activeDetail} />}
    </section>
  );
}
