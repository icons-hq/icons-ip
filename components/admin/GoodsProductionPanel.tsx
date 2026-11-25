'use client';
import { useEffect, useRef, useState } from 'react';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { readGoodsProductionAction, saveGoodsProductionAction } from '@/app/admin/production-actions';
import { productionLeadLabel, type GoodsProductionPolicy } from '@/lib/order-production';
import { AdminField, AdminFormGrid } from './console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_TEXTAREA_CLASS, GoodReadback } from './GoodEditorParts';
const CHECK_LABEL_CLASS = 'flex cursor-pointer items-start gap-2 text-sm [&>input]:mt-0.5';
const draftOf = (p: GoodsProductionPolicy) => ({ enabled: p.enabled, leadDays: p.leadDays?.toString() ?? '', dayBasis: p.dayBasis, closedDates: p.closedDates.join('\n'), publicNote: p.publicNote, evidence: p.evidence, confirmed: false });
type Draft = ReturnType<typeof draftOf>;
/**
 * 주문제작 입력(저장된 상품 패널과 등록 화면의 '상품과 함께 저장'이 같이 쓴다 — T15b). 저장·불러오기는 부르는 쪽이 한다.
 * `idPrefix`는 한 화면에 두 벌이 그려질 때 라벨 연결이 겹치지 않게 한다.
 * 사용을 고르면 기간·휴무일·안내 입력이 열리고, 입력한 기간은 고객 화면 문장으로 바로 되읽는다('글보다 화면' 2·3단계).
 * 설정 근거·확인 체크는 서버(저장 액션·DB 함수)가 요구해 그대로 둔다.
 */
export function GoodsProductionFields({ draft, onChange, idPrefix = 'production' }: { draft: Draft; onChange: (draft: Draft) => void; idPrefix?: string }) {
 const days = /^[1-9][0-9]*$/.test(draft.leadDays) && Number(draft.leadDays) <= 365 ? Number(draft.leadDays) : null;
 /* 끄면 닫히는 칸에 규칙에 맞지 않는 기간이 남아 저장이 보이지 않는 칸 때문에 막히지 않게, 그런 값만 비운다. */
 /* 고객 상품 상세(components/shop/GoodsTransactionTerms)가 쓰는 기간 표기와 같다. */
 const lead = days === null ? null : productionLeadLabel({ version: 1, goodId: '', revision: 1, leadDays: days, dayBasis: draft.dayBasis, closedDates: [], publicNote: '' });
 return <>
   <label className={`${CHECK_LABEL_CLASS} font-medium`}><input type="checkbox" checked={draft.enabled} onChange={e => onChange({ ...draft, enabled: e.target.checked, leadDays: e.target.checked || days !== null || !draft.leadDays ? draft.leadDays : '' })} />이 상품은 주문을 받은 뒤에 제작합니다</label>
   {draft.enabled ? <>
    <p className="text-xs text-muted-foreground">예약판매와는 함께 쓸 수 없습니다. 제작 시작·완료는 주문 상세에서 기록하며, 완료하기 전에는 출고지시와 발송을 할 수 없습니다.</p>
    <AdminFormGrid><AdminField label="결제 확인 후 발송 예정 기간 (일)" inputId={`${idPrefix}-lead`}><input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" id={`${idPrefix}-lead`} type="number" min="1" max="365" required value={draft.leadDays} onChange={e => onChange({ ...draft, leadDays: e.target.value })} /></AdminField>
     <AdminField label="기간 계산 기준" inputId={`${idPrefix}-basis`}><NativeSelect className="w-full" id={`${idPrefix}-basis`} value={draft.dayBasis} onChange={e => onChange({ ...draft, dayBasis: e.target.value as Draft['dayBasis'] })}><option value="calendar">달력일 · 주말 포함</option><option value="business">영업일 · 토·일 및 휴무일 제외</option></NativeSelect></AdminField></AdminFormGrid>
    {draft.dayBasis === 'business' ? <AdminField label="발송하지 않는 날 (휴무일)" inputId={`${idPrefix}-closed`} hint="토·일은 자동으로 뺍니다. 공휴일은 빼지 않으니 쉬는 날을 직접 적어 주세요."><textarea className={`${GOOD_TEXTAREA_CLASS} tabular-nums`} data-slot="textarea" id={`${idPrefix}-closed`} rows={4} placeholder={'한 줄에 하루씩\n2026-12-25\n2027-01-01'} value={draft.closedDates} onChange={e => onChange({ ...draft, closedDates: e.target.value })} /></AdminField> : null}
    <AdminField label="고객 안내 (선택)" inputId={`${idPrefix}-public`} hint="상품 상세·주문서·주문 상세에 보입니다."><input className={GOOD_INPUT_CLASS} data-slot="input" id={`${idPrefix}-public`} maxLength={1000} placeholder="예: 주문 접수 뒤 한 개씩 만들어 보내 드립니다" value={draft.publicNote} onChange={e => onChange({ ...draft, publicNote: e.target.value })} /></AdminField>
    {lead ? <GoodReadback>상품 상세에는 &lsquo;결제 확인 후 {lead} 내 발송 예정입니다. 배송 기간은 별도입니다.&rsquo;로 보입니다. 결제 확인 당일은 세지 않고, 마지막 날 자정(KST) 전까지가 발송 예정 기한입니다.</GoodReadback> : null}
   </> : null}
   <AdminField label="설정 근거 (관리자만 봄)" inputId={`${idPrefix}-evidence`}><input className={GOOD_INPUT_CLASS} data-slot="input" id={`${idPrefix}-evidence`} minLength={2} maxLength={1000} required placeholder="예: 제작 업체 납기가 영업일 5일입니다" value={draft.evidence} onChange={e => onChange({ ...draft, evidence: e.target.value })} /></AdminField>
   <label className={CHECK_LABEL_CLASS}><input type="checkbox" checked={draft.confirmed} onChange={e => onChange({ ...draft, confirmed: e.target.checked })} required />위 발송 예정 기간이 맞고, 제작을 시작한 뒤의 취소는 담당자가 검토한다는 것을 확인했습니다.</label>
 </>;
}
/** showDisabledReason=false면 잠금 이유 문장을 본문에 그리지 않는다(상품 편집기가 패널 위에 공통 잠금 안내를 보일 때). 잠금은 disabledReason이 맡는다. */
type Props = { goodId: string; accountId: string; disabledReason?: string; showDisabledReason?: boolean };
export function GoodsProductionPanel(props: Props) { return <ClaimContactSession actorId={props.accountId} pendingMessage="로그인 상태를 확인하고 있습니다.">{(identity, scope) => <Panel {...props} identity={identity} scope={scope} />}</ClaimContactSession>; }
function Panel({ goodId, disabledReason, showDisabledReason = true, identity, scope }: Props & { identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const [policy, setPolicy] = useState<GoodsProductionPolicy | null>(null), [draft, setDraft] = useState<Draft | null>(null), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState('');
 const alive = useRef(true), busy = useRef(false), dispatched = useRef<{ values: unknown; revision: number; operation: string } | null>(null);
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 async function read() { if (busy.current || uncertain) return; const ticket = scope.capture(); if (!ticket) return; busy.current = true; setPending(true);
  try { const result = await readGoodsProductionAction(goodId); if (!alive.current || !scope.canApply(ticket)) return;
   if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setMessage('현재 주문제작 설정을 불러왔습니다.'); } else setMessage(result.error ?? '설정을 읽지 못했습니다.');
  } finally { busy.current = false; if (alive.current) setPending(false); }
 }
 async function save() { if (busy.current || disabledReason || !draft || !policy || !draft.confirmed) return; const ticket = scope.capture(); if (!ticket) return;
  if (draft.leadDays && !/^[1-9][0-9]*$/.test(draft.leadDays)) { setMessage('발송 예정 기간은 1~365일의 정수로 입력해주세요.'); return; }
  const request = dispatched.current ?? { values: { ...draft, leadDays: draft.leadDays ? Number(draft.leadDays) : null, closedDates: draft.dayBasis === 'calendar' ? [] : draft.closedDates.split(/[\s,]+/).map(d => d.trim()).filter(Boolean) }, revision: policy.revision, operation: crypto.randomUUID() };
  dispatched.current = request; busy.current = true; setPending(true);
  try { const result = await saveGoodsProductionAction(goodId, request.values, request.revision, request.operation, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); dispatched.current = null; setUncertain(false); setMessage('주문제작 설정을 저장했습니다. 새 주문부터 적용됩니다.'); }
   else { setMessage(result.error ?? '결과를 확인하지 못했습니다.'); setUncertain(uncertain || Boolean(result.uncertain)); if (!uncertain && !result.uncertain) dispatched.current = null; }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setMessage('저장 결과를 확인하지 못했습니다. [같은 요청으로 저장 결과 확인]을 눌러 저장됐는지 확인해주세요.'); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 return <div className="flex min-w-0 flex-col gap-4" data-goods-production=""><button type="button" className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" disabled={pending || uncertain} onClick={() => { void read(); }}>현재 주문제작 설정 불러오기</button>
  {draft ? <form className="flex min-w-0 flex-col gap-4" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border p-4" disabled={pending || uncertain || Boolean(disabledReason)}><legend className="sr-only">주문 후 제작</legend>
   <GoodsProductionFields draft={draft} onChange={setDraft} />
  </fieldset><button type="submit" className={`${buttonVariants()} self-start`} data-slot="button" disabled={pending || !draft.confirmed || Boolean(disabledReason)}>{uncertain ? '같은 요청으로 저장 결과 확인' : '주문제작 설정 저장'}</button></form> : null}
  {showDisabledReason && disabledReason ? <p className={GOOD_NOTE_CLASS} role="status">{disabledReason}</p> : null}{message ? <p className="text-sm font-medium" role="status">{message}</p> : null}
 </div>;
}
