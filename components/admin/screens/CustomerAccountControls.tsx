'use client';
import { useActionState, useState } from 'react';
import { adjustMemberLoyaltyAction, recalculateMemberLoyaltyAction, suspendAdminMemberAction, unsuspendAdminMemberAction, type AdminMemberMutationActionState } from '@/app/admin/member-actions';
import { AdminField, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { Button } from '@/components/admin/kit/ui/button';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { canModerateAdminMember, type AdminMemberDetail, type AdminMemberRole } from '@/lib/admin/members';
import { isLoyaltyGrade, LOYALTY_GRADES, loyaltyBasisSummary, loyaltyGradeLabel } from '@/lib/loyalty';

const EMPTY: AdminMemberMutationActionState = {};
const FORM_CLASS = 'flex flex-col gap-4';
function Feedback({ state }: { state: AdminMemberMutationActionState }) {
  return <>{state.errors?.form ? <p className="bg-transparent text-sm text-destructive" role="alert">{state.errors.form}</p> : null}{state.message ? <p className="text-sm text-[var(--wc-success)]" role="status">{state.message}</p> : null}</>;
}
export function CustomerSuspensionControl({ actor, customer }: { actor: { id: string; role: AdminMemberRole }; customer: AdminMemberDetail }) {
  const [suspendState, suspend, suspending] = useActionState(suspendAdminMemberAction, EMPTY);
  const [unsuspendState, unsuspend, unsuspending] = useActionState(unsuspendAdminMemberAction, EMPTY);
  const [reason, setReason] = useState('');
  const allowed = canModerateAdminMember({ actorId: actor.id, memberId: customer.id, moderation: customer.moderation });
  return <AdminSectionCard title="계정 상태">
    <p className="text-sm">{customer.suspendedAt ? '정지된 계정입니다.' : '이용 중인 계정입니다.'}</p>
    {customer.suspensionReason ? <p className="text-sm text-muted-foreground wrap-anywhere">내부 사유 · {customer.suspensionReason}</p> : null}
    {!allowed ? <p className="text-sm text-muted-foreground">이 계정은 현재 권한으로 제재할 수 없습니다.</p> : customer.suspendedAt ?
      <form action={unsuspend} className={FORM_CLASS}><input type="hidden" name="profileId" value={customer.id} />
        <Button className="self-start" disabled={unsuspending} type="submit" variant="outline">{unsuspending ? '처리 중' : '정지 해제'}</Button><Feedback state={unsuspendState} />
      </form> :
      <form action={suspend} className={FORM_CLASS} onSubmit={(event) => {
        if (!window.confirm('이 고객의 신규 작성·구매·예매·카드팩 개봉·게임 플레이를 정지합니다. 계속할까요?')) event.preventDefault();
      }}>
        <input type="hidden" name="profileId" value={customer.id} />
        <AdminField label="내부 정지 사유" inputId="customer-suspension-reason" error={suspendState.errors?.reason}>
          <Textarea className="min-h-24" id="customer-suspension-reason" name="reason" rows={3} required maxLength={200} disabled={suspending}
            value={reason} onChange={(event) => setReason(event.target.value)} aria-invalid={Boolean(suspendState.errors?.reason)}
            aria-describedby={suspendState.errors?.reason ? 'customer-suspension-reason-error' : undefined} />
        </AdminField>
        <Button className="self-start" disabled={suspending} type="submit" variant="destructive">{suspending ? '처리 중' : '계정 정지'}</Button><Feedback state={suspendState} />
      </form>}
  </AdminSectionCard>;
}
export function CustomerLoyaltyControl({ customer }: { customer: AdminMemberDetail }) {
  const [adjustState, adjust, adjusting] = useActionState(adjustMemberLoyaltyAction, EMPTY);
  const [recalcState, recalc, recalculating] = useActionState(recalculateMemberLoyaltyAction, EMPTY);
  const [note, setNote] = useState('');
  const [grade, setGrade] = useState(isLoyaltyGrade(customer.loyaltyGrade) ? customer.loyaltyGrade : 'welcome');
  return <AdminSectionCard title="등급 관리">
    <p className="text-sm leading-relaxed text-muted-foreground">{loyaltyBasisSummary()}</p>
    <form action={adjust} className={FORM_CLASS}>
      <input name="profileId" type="hidden" value={customer.id} />
      <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <AdminField label="보정 등급" inputId="customer-grade" error={adjustState.errors?.grade}>
          <AdminSelect id="customer-grade" name="grade" value={grade} onChange={(event) => {
            if (isLoyaltyGrade(event.target.value)) setGrade(event.target.value);
          }} disabled={adjusting || recalculating} aria-invalid={Boolean(adjustState.errors?.grade)}
            aria-describedby={adjustState.errors?.grade ? 'customer-grade-error' : undefined}>
            {LOYALTY_GRADES.map((grade) => <option key={grade} value={grade}>{loyaltyGradeLabel(grade)}</option>)}
          </AdminSelect>
        </AdminField>
        <AdminField label="보정 사유" inputId="customer-grade-note" error={adjustState.errors?.note}>
          <Textarea className="min-h-24" id="customer-grade-note" name="note" rows={3} required maxLength={200} disabled={adjusting || recalculating}
            value={note} onChange={(event) => setNote(event.target.value)} aria-invalid={Boolean(adjustState.errors?.note)}
            aria-describedby={adjustState.errors?.note ? 'customer-grade-note-error' : undefined} />
        </AdminField>
      </div>
      <Button className="self-start" disabled={adjusting || recalculating} type="submit">{adjusting ? '보정 중' : '등급 보정'}</Button><Feedback state={adjustState} />
    </form>
    <form action={recalc} className={`${FORM_CLASS} border-t pt-4`}><input name="profileId" type="hidden" value={customer.id} />
      <Button className="self-start" disabled={adjusting || recalculating} type="submit" variant="outline">{recalculating ? '재산정 중' : '실적으로 재산정'}</Button><Feedback state={recalcState} />
    </form>
  </AdminSectionCard>;
}
