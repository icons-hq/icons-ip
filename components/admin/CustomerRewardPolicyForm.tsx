'use client';
import { useState, useTransition } from 'react';
import { readCustomerRewardPolicyAction, saveCustomerRewardPolicyAction } from '@/app/admin/customer-reward-actions';
import { REWARD_GRADES, rewardPercentBps, type CustomerRewardPolicy } from '@/lib/admin/customer-rewards';
import { AdminField } from './console/AdminKit';
import { useGoodsGroupSession } from './GoodsGroupOperation';
import '@/app/styles/admin-customer-rewards.css';
const draftOf = (policy: CustomerRewardPolicy) => ({ gradeEnabled: policy.gradeEnabled, rates: Object.fromEntries(REWARD_GRADES.map(grade => [grade, policy.gradeRates[grade] === null ? '' : String(policy.gradeRates[grade]! / 100)])),
  bestEnabled: policy.bestEnabled, amount: policy.bestAmount?.toString() ?? '', days: policy.bestValidityDays?.toString() ?? '', reversal: policy.bestReversal ?? '', evidence: policy.evidence, acknowledged: false });
export function CustomerRewardPolicyForm({ initial, actorId, sessionId }: { initial: CustomerRewardPolicy; actorId: string; sessionId: string | null }) {
  const [policy, setPolicy] = useState(initial), [draft, setDraft] = useState(() => draftOf(initial)), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false);
  const [pending, start] = useTransition(), session = useGoodsGroupSession(actorId, sessionId);
  const blocked = pending || uncertain || session.blocked;
  function save() {
    if (blocked || !sessionId || !session.current()) return;
    const gradeRates = Object.fromEntries(REWARD_GRADES.map(grade => [grade, draft.rates[grade] === '' ? null : rewardPercentBps(draft.rates[grade])]));
    if (REWARD_GRADES.some(grade => draft.rates[grade] !== '' && gradeRates[grade] === null) || [draft.amount, draft.days].some(value => value !== '' && !/^[1-9][0-9]*$/.test(value))) { setMessage('적립률은 0~100%의 소수 둘째 자리까지, 금액과 기간은 양의 정수로 입력해주세요.'); return; }
    const values = { gradeEnabled: draft.gradeEnabled, gradeRates, bestEnabled: draft.bestEnabled, bestAmount: draft.amount ? Number(draft.amount) : null,
      bestValidityDays: draft.days ? Number(draft.days) : null, bestReversal: draft.reversal || null, evidence: draft.evidence, acknowledged: draft.acknowledged };
    start(async () => {
      const result = await saveCustomerRewardPolicyAction(values, policy.revision, crypto.randomUUID(), { actorId, sessionId });
      if (!session.current()) return;
      if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setMessage('보상 정책을 저장했습니다. 이후 주문·선정부터 적용합니다.'); }
      else { setUncertain(true); setMessage(result.error ?? '현재 저장본을 조회해주세요.'); }
    });
  }
  function read() { start(async () => { const result = await readCustomerRewardPolicyAction(); if (!session.current()) return;
    if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setUncertain(false); setMessage('현재 저장본을 불러왔습니다.'); }
    else setMessage(result.error ?? '현재 저장본을 조회하지 못했습니다.'); }); }
  return <form id="customer-rewards" className="admin-customer-rewards" onSubmit={event => { event.preventDefault(); save(); }}>
    <p>기본 적립금의 지급 상한·최대 보유액·환불 회수 기준을 함께 적용합니다. 자동 지급은 초기에는 꺼져 있습니다.</p>
    {!initial.baseCreditEnabled ? <p>기본 적립금 정책을 활성화한 뒤 자동 보상을 켤 수 있습니다.</p> : null}
    <fieldset disabled={blocked}><legend>등급별 주문 적립</legend><label><input type="checkbox" checked={draft.gradeEnabled} onChange={event => setDraft({ ...draft, gradeEnabled: event.target.checked })} /> 등급별 최종 적립률 사용</label>
      <p>기본 지급률·고정액을 아래 최종 적립률로 대체합니다. 주문 생성 시 등급과 적립률을 고정하고 거래확정 때 지급합니다. 배송비와 사용한 적립금은 적립 기준에서 제외합니다.</p>
      <div className="wc-admin-kit__form-grid">{REWARD_GRADES.map(grade => <AdminField key={grade} label={`${grade.toUpperCase()} 최종 적립률 (%)`} inputId={`reward-rate-${grade}`}><input id={`reward-rate-${grade}`} type="number" min="0" max="100" step="0.01" value={draft.rates[grade]} onChange={event => setDraft({ ...draft, rates: { ...draft.rates, [grade]: event.target.value } })} /></AdminField>)}</div>
    </fieldset>
    <fieldset disabled={blocked}><legend>BEST 리뷰 보상</legend><label><input type="checkbox" checked={draft.bestEnabled} onChange={event => setDraft({ ...draft, bestEnabled: event.target.checked })} /> BEST 선정 시 적립금 자동 지급</label>
      <p>리뷰별 최초 1회만 지급합니다. 선정 해제 후 다시 선정해도 중복 지급하지 않습니다. 설정은 이후 선정에 적용하며, 이미 접수된 보상은 당시 정책을 유지합니다.</p>
      <div className="wc-admin-kit__form-grid"><AdminField label="리뷰 1건당 적립금 (원)" inputId="best-reward-amount"><input id="best-reward-amount" type="number" min="1" step="1" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} /></AdminField>
        <AdminField label="보상 유효기간 (일)" inputId="best-reward-days"><input id="best-reward-days" type="number" min="1" max="36500" step="1" value={draft.days} onChange={event => setDraft({ ...draft, days: event.target.value })} /></AdminField>
        <AdminField label="선정 해제·리뷰 변경·구매 취소 시" inputId="best-reward-reversal"><select id="best-reward-reversal" value={draft.reversal} onChange={event => setDraft({ ...draft, reversal: event.target.value })}><option value="">회수 정책 선택</option><option value="keep">이미 지급한 보상 유지</option><option value="revoke">회수 · 사용한 금액은 향후 적립금 상계</option></select></AdminField></div>
      <p>지급 시 최대 보유액을 넘는 부분은 지급하지 않습니다. 실제 지급·회수 결과는 리뷰 상세와 고객 적립금 내역에 남깁니다. 보상을 받은 공개 리뷰에는 혜택 표시를 붙입니다.</p>
    </fieldset>
    <AdminField label="정책 근거·운영 메모" inputId="customer-reward-evidence"><textarea id="customer-reward-evidence" disabled={blocked} rows={3} maxLength={2000} value={draft.evidence} onChange={event => setDraft({ ...draft, evidence: event.target.value })} /></AdminField>
    <label><input type="checkbox" disabled={blocked} checked={draft.acknowledged} onChange={event => setDraft({ ...draft, acknowledged: event.target.checked })} /> 적용 시점·지급 상한·보상 회수 정책을 확인했습니다.</label>
    <div className="wc-admin-kit__actions"><button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={blocked || !draft.acknowledged}>등급·리뷰 보상 정책 저장</button><button type="button" className="wc-admin-kit__button" disabled={pending || session.blocked} onClick={read}>현재 저장본 다시 불러오기</button></div>
    {message ? <p role="status">{message}</p> : null}{session.blocked ? <p role="alert">로그인 상태가 바뀌었습니다. 현재 계정으로 다시 열어주세요.</p> : null}
  </form>;
}
