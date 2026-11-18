'use client';
import { useActionState, useRef, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  previewMemberWithdrawalInquiryAction,
  processMemberWithdrawalAction,
  retryMemberWithdrawalSigninBlockAction,
  type MemberWithdrawalActionState,
} from '@/app/admin/member-withdrawal-actions';
import { AdminField, AdminNotice, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { adminConfirm } from '@/lib/admin/confirm';
import { canModerateAdminMember, type AdminMemberDetail, type AdminMemberRole } from '@/lib/admin/members';
import {
  MEMBER_WITHDRAWAL_BLOCKER_LABELS,
  MEMBER_WITHDRAWAL_EFFECTS,
  MEMBER_WITHDRAWAL_NOTE_MAX,
  MEMBER_WITHDRAWAL_RETAINED,
  memberWithdrawalConfirmMessage,
} from '@/lib/admin/member-withdrawal';
import { formatOrderDateTime } from '@/lib/orders';
import { DISCLOSURE_SUMMARY_CLASS } from './cs-kit-classes';

const EMPTY: MemberWithdrawalActionState = {};
const FORM_CLASS = 'flex flex-col gap-4';

function Feedback({ state }: { state: MemberWithdrawalActionState }) {
  return <>
    {state.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
    {state.errors?.form ? <p className="text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
    {state.blockers?.length ? <ul className="flex list-disc flex-col gap-1 pl-5 text-sm" data-member-withdrawal-blockers="">
      {state.blockers.map((blocker) => <li key={blocker.code}>{MEMBER_WITHDRAWAL_BLOCKER_LABELS[blocker.code]} {blocker.count.toLocaleString('ko-KR')}건</li>)}
    </ul> : null}
  </>;
}

/**
 * 1:1 문의로 받은 회원 탈퇴의 처리(원장 CUS-036). 탈퇴 신청 기능이 꺼져 있는 동안의 임시 절차를 한 동작으로 묶는다 —
 * DB가 진행 중 의무를 확인하고 정지·비법정 개인정보 삭제·로그인 세션 종료·감사를 한 번에 하며, 뒤이어 재로그인을 막는다.
 * 완전 삭제(hard delete)가 아니므로 남는 정보를 처리 전에 함께 보여준다. 정지와 같은 권한·대상 보호(canModerate)를 따른다.
 */
export function CustomerWithdrawalControl({ actor, customer }: { actor: { id: string; role: AdminMemberRole }; customer: AdminMemberDetail }) {
  const [state, process, processing] = useActionState(processMemberWithdrawalAction, EMPTY);
  const [retryState, retry, retrying] = useActionState(retryMemberWithdrawalSigninBlockAction, EMPTY);
  const [inquiryReference, setInquiryReference] = useState('');
  const [note, setNote] = useState('');
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  /* 확인을 마친 제출 하나만 통과시키는 표식. 대조·확인 중의 거듭 제출은 무시한다. */
  const confirmedRef = useRef(false);
  const checkingRef = useRef(false);
  /* 확인창에서 대조한 문의 번호를 함께 보낸다 — 서버 액션이 입력한 번호와 다르면 처리하지 않는다. */
  const confirmedInputRef = useRef<HTMLInputElement>(null);
  const allowed = canModerateAdminMember({ actorId: actor.id, memberId: customer.id, moderation: customer.moderation });
  const withdrawal = customer.withdrawal;

  /* 되돌릴 수 없는 처리라 문의 번호의 유형·제목·작성일을 불러와 확인창에서 대조하게 한다(계정 유형이 아니면 경고).
     대조하는 동안 입력은 읽기 전용이다. 확인하면 대조한 번호를 숨은 칸에 적고 같은 제출자로 다시 제출한다. */
  async function confirmWithInquiry(event: FormEvent<HTMLFormElement>) {
    if (confirmedRef.current) { confirmedRef.current = false; return; }
    event.preventDefault();
    if (checkingRef.current) return;
    checkingRef.current = true;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as { submitter?: HTMLElement | null }).submitter ?? undefined;
    setCheckError(null);
    setChecking(true);
    try {
      const preview = await previewMemberWithdrawalInquiryAction(customer.id, inquiryReference);
      if (!preview.ok) { setCheckError(preview.error); return; }
      const ok = await adminConfirm({ title: '탈퇴 요청 처리', message: memberWithdrawalConfirmMessage(preview.inquiry), confirmLabel: '탈퇴 처리', destructive: true });
      if (!ok || !form.isConnected) return;
      if (confirmedInputRef.current) confirmedInputRef.current.value = String(preview.inquiry.reference);
      confirmedRef.current = true;
      try { form.requestSubmit(submitter); } finally { confirmedRef.current = false; }
    } catch {
      setCheckError('문의를 확인하지 못했습니다. 다시 시도해주세요.');
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }

  return <AdminSectionCard title="탈퇴 요청 처리">
    {withdrawal === undefined || withdrawal === null
      ? <AdminNotice title="탈퇴 처리 상태를 불러오지 못했습니다." tone="warning">화면을 새로고침한 뒤 다시 확인해주세요.</AdminNotice>
      : withdrawal.processed
        ? <div className="flex flex-col gap-3" data-member-withdrawal="processed">
          <AdminNotice title="탈퇴 요청을 처리한 계정입니다." tone="danger">
            <span className="tabular-nums">문의 #{withdrawal.inquiryReference} · {withdrawal.processedAt ? formatOrderDateTime(withdrawal.processedAt) : ''} 처리</span>
          </AdminNotice>
          {withdrawal.signinBlocked
            ? <p className="text-sm text-muted-foreground">재로그인 차단 · {withdrawal.signinBlockedAt ? formatOrderDateTime(withdrawal.signinBlockedAt) : ''} 적용</p>
            : <form action={retry} className={FORM_CLASS}>
              <AdminNotice title="재로그인 차단이 아직 적용되지 않았습니다." tone="warning">정지·삭제는 끝났습니다. 다시 적용해 로그인을 막아주세요.</AdminNotice>
              <input name="profileId" type="hidden" value={customer.id} />
              {allowed ? <Button className="self-start" disabled={retrying} type="submit" variant="outline">{retrying ? '적용 중' : '재로그인 차단 다시 적용'}</Button> : null}
              <Feedback state={retryState} />
            </form>}
          <Feedback state={state} />
        </div>
        : !allowed
          ? <p className="text-sm text-muted-foreground">이 계정은 현재 권한으로 탈퇴 처리할 수 없습니다.</p>
          : <details className="group/withdrawal" data-member-withdrawal="pending">
            <summary className={DISCLOSURE_SUMMARY_CLASS}>1:1 문의로 받은 탈퇴 처리<ChevronDown aria-hidden="true" className="size-4 transition-transform group-open/withdrawal:rotate-180" /></summary>
            <div className="mt-3 flex flex-col gap-4">
              <div className="flex flex-col gap-2 text-sm leading-relaxed">
                <p>진행 중인 주문·배송·취소·환불, 이용 전 티켓, 정기구매·선물, 운영 권한이 있으면 처리하지 않고 남은 일을 알려줍니다. 처리하면 한 번에 다음을 합니다.</p>
                <ul className="flex list-disc flex-col gap-1 pl-5">{MEMBER_WITHDRAWAL_EFFECTS.map((effect) => <li key={effect}>{effect}</li>)}</ul>
                <p className="text-muted-foreground">완전 삭제가 아니라 다음은 남습니다.</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">{MEMBER_WITHDRAWAL_RETAINED.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <form action={process} className={FORM_CLASS} onSubmit={(event) => { void confirmWithInquiry(event); }}>
                <input name="profileId" type="hidden" value={customer.id} />
                <input defaultValue="" name="confirmedInquiryReference" ref={confirmedInputRef} type="hidden" />
                <AdminField error={state.errors?.inquiryReference} hint="이 고객이 탈퇴를 요청한 1:1 문의의 번호입니다(문의 탭의 #번호)." inputId="customer-withdrawal-inquiry" label="문의 번호">
                  <Input aria-describedby={state.errors?.inquiryReference ? 'customer-withdrawal-inquiry-error' : 'customer-withdrawal-inquiry-hint'}
                    aria-invalid={Boolean(state.errors?.inquiryReference)} autoComplete="off" className="max-w-48" disabled={processing} readOnly={checking}
                    id="customer-withdrawal-inquiry" inputMode="numeric" maxLength={16} name="inquiryReference" onChange={(event) => setInquiryReference(event.target.value)}
                    placeholder="예: 1234" required value={inquiryReference} />
                </AdminField>
                <AdminField error={state.errors?.note} hint="정지 사유로 남는 내부 기록입니다. 고객의 연락처·주소 같은 개인정보는 적지 마세요." inputId="customer-withdrawal-note" label="처리 메모">
                  <Textarea aria-describedby={state.errors?.note ? 'customer-withdrawal-note-error' : 'customer-withdrawal-note-hint'}
                    aria-invalid={Boolean(state.errors?.note)} className="min-h-20" disabled={processing} id="customer-withdrawal-note" readOnly={checking}
                    maxLength={MEMBER_WITHDRAWAL_NOTE_MAX} name="note" onChange={(event) => setNote(event.target.value)} required rows={2} value={note} />
                </AdminField>
                <Button className="self-start" disabled={processing || checking} type="submit" variant="danger">{processing ? '처리 중' : checking ? '문의 확인 중' : '탈퇴 요청 처리'}</Button>
                {checkError ? <p className="text-sm text-destructive" role="alert">{checkError}</p> : null}
                <Feedback state={state} />
              </form>
            </div>
          </details>}
  </AdminSectionCard>;
}
