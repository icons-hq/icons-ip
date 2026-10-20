'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { readLoyaltyPolicyAction, saveLoyaltyPolicyAction } from '@/app/admin/loyalty-policy-actions';
import { parseLoyaltyCriteria, type ConfigurableGrade, type LoyaltyCriterion, type LoyaltyPolicy, type LoyaltyPolicyData } from '@/lib/loyalty-policy';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import type { CustomerRewardPolicy } from '@/lib/admin/customer-rewards';
import '@/app/styles/admin-loyalty-policy.css';

const AMOUNT_PRESETS = [10000, 50000, 100000, 200000, 300000, 500000, 1000000];
const COUNT_PRESETS = [1, 2, 3, 5, 10];
type Draft = { grade: ConfigurableGrade; enabled: boolean; amount: string; itemCount: string;
  amountMode: string; itemCountMode: string; customAmount: string | null; customItemCount: string | null };
type Request = { tiers: LoyaltyCriterion[]; revision: number; operationId: string };
const presetMode = (value: number | null, options: number[]) => value === null ? '' : options.includes(value) ? String(value) : 'custom';
const toDraft = (policy: LoyaltyPolicy): Draft[] => policy.tiers.map(tier => ({ ...tier,
  amount: tier.amount?.toString() ?? '', itemCount: tier.itemCount?.toString() ?? '',
  amountMode: presetMode(tier.amount, AMOUNT_PRESETS), itemCountMode: presetMode(tier.itemCount, COUNT_PRESETS),
  customAmount: presetMode(tier.amount, AMOUNT_PRESETS) === 'custom' ? String(tier.amount) : null,
  customItemCount: presetMode(tier.itemCount, COUNT_PRESETS) === 'custom' ? String(tier.itemCount) : null,
}));
function criteria(draft: Draft[]): LoyaltyCriterion[] | null {
  if (draft.some(tier => [tier.amount, tier.itemCount].some(value => value !== '' && !/^[1-9]\d*$/.test(value)))) return null;
  return parseLoyaltyCriteria(draft.map(tier => ({ grade: tier.grade, enabled: tier.enabled, amount: tier.amount === '' ? null : Number(tier.amount), itemCount: tier.itemCount === '' ? null : Number(tier.itemCount) })));
}
function criterionText(tier: LoyaltyCriterion) {
  if (!tier.enabled) return '사용 안 함';
  return [tier.amount === null ? null : `${tier.amount.toLocaleString('ko-KR')}원 이상`, tier.itemCount === null ? null : `상품 주문 항목 ${tier.itemCount.toLocaleString('ko-KR')}건 이상`].filter(Boolean).join(' 또는 ');
}
function savedTime(value: string) { return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }); }

export function LoyaltyPolicyScreen({ data, rewards }: { data: LoyaltyPolicyData; rewards?: CustomerRewardPolicy }) {
  const [base, setBase] = useState(data.policy);
  const [draft, setDraft] = useState(() => toDraft(data.policy));
  const [coupons, setCoupons] = useState(data.coupons);
  const [request, setRequest] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [latest, setLatest] = useState<LoyaltyPolicyData | null>(null);
  const [reading, setReading] = useState(false);
  const [sample, setSample] = useState({ amount: '', itemCount: '' });
  const [editor, setEditor] = useState<{ index: number; before: Draft } | null>(null);
  const [editorError, setEditorError] = useState('');
  const locked = busy || uncertain;
  const parsed = criteria(draft);
  const sampleReady = [sample.amount, sample.itemCount].every(value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)));
  const estimated = parsed && sampleReady ? [...parsed].reverse().find(tier => tier.enabled
    && ((tier.amount !== null && Number(sample.amount) >= tier.amount) || (tier.itemCount !== null && Number(sample.itemCount) >= tier.itemCount)))?.grade ?? 'welcome' : null;

  function edit(index: number, values: Partial<Draft>) {
    if (locked) return;
    setDraft(current => current.map((tier, i) => i === index ? { ...tier, ...values } : tier));
    setRequest(null); setFeedback({});
  }
  function selectPreset(index: number, field: 'amount' | 'itemCount', mode: string) {
    const tier = draft[index];
    if (field === 'amount') edit(index, { amountMode: mode, amount: mode === 'custom' ? tier.customAmount ?? tier.amount : mode,
      customAmount: mode === 'custom' ? tier.customAmount ?? tier.amount : tier.customAmount });
    else edit(index, { itemCountMode: mode, itemCount: mode === 'custom' ? tier.customItemCount ?? tier.itemCount : mode,
      customItemCount: mode === 'custom' ? tier.customItemCount ?? tier.itemCount : tier.customItemCount });
    setEditorError('');
  }
  function openEditor(index: number) {
    if (locked) return;
    setEditor({ index, before: { ...draft[index] } }); setEditorError('');
  }
  function closeEditor() {
    if (!editor || locked) return;
    setDraft(current => current.map((tier, index) => index === editor.index ? editor.before : tier));
    setEditor(null); setEditorError(''); setRequest(null);
  }
  function applyEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!criteria(draft)) { setEditorError('사용 중인 등급에 조건을 하나 이상 입력하고, 상위 등급의 금액·항목 수가 하위 등급보다 큰지 확인해주세요.'); return; }
    setEditor(null); setEditorError('');
  }
  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy || reading || (uncertain && !request)) return;
    const tiers = criteria(draft);
    if (!tiers) { setFeedback({ error: '사용할 등급은 SILVER부터 순서대로 선택하고, 금액 또는 상품 주문 항목 수를 하나 이상 입력해주세요. 위 등급의 조건은 아래 등급보다 커야 합니다.' }); return; }
    const active = request ?? { tiers, revision: base.revision, operationId: crypto.randomUUID() };
    setRequest(active); setBusy(true); setFeedback({});
    try {
      const result = await saveLoyaltyPolicyAction(active.tiers, active.revision, active.operationId);
      if ('error' in result) { setUncertain(Boolean(result.uncertain)); setFeedback({ error: result.error }); return; }
      setBase({ tiers: active.tiers, ...result.receipt });
      setDraft(toDraft({ tiers: active.tiers, ...result.receipt }));
      setRequest(null); setUncertain(false); setLatest(null);
      setFeedback({ message: '등급 조건을 저장했습니다. 고객 등급은 다음 결제 확정·취소 또는 수동 재산정 때 반영됩니다.' });
    } catch {
      setUncertain(true); setFeedback({ error: '저장 결과를 확인하지 못했습니다. 입력을 유지하고 같은 요청으로 다시 확인해주세요.' });
    } finally { setBusy(false); }
  }
  async function readLatest() {
    if (reading || locked) return;
    setReading(true);
    try {
      const result = await readLoyaltyPolicyAction();
      if ('error' in result) { setFeedback({ error: result.error }); return; }
      setLatest(result.data); setCoupons(result.data.coupons);
    } catch { setFeedback({ error: '최신 정책을 불러오지 못했습니다. 작성한 입력은 유지됩니다.' }); }
    finally { setReading(false); }
  }
  function applyLatest(replaceDraft: boolean) {
    if (!latest || locked) return;
    setBase(latest.policy);
    if (replaceDraft) setDraft(toDraft(latest.policy));
    setRequest(null); setLatest(null);
    setFeedback({ message: replaceDraft ? '최신 정책으로 입력을 바꿨습니다.' : '작성한 입력을 유지했습니다. 최신 정책과 비교한 조건을 확인한 뒤 저장해주세요.' });
  }

  return <section className="admin-loyalty-policy wc-admin-kit">
    <div className="admin-loyalty-policy__intro">
      <div><h2>고객등급 설정</h2><p>WELCOME은 기본 등급입니다. 최근 90일의 결제 확정·취소 제외 실적으로 SILVER, GOLD, PLATINUM을 산정합니다.</p></div>
      <p className="admin-loyalty-policy__stamp">저장 버전 {base.revision} · {savedTime(base.updatedAt)} KST</p>
    </div>
    <form onSubmit={save} className="admin-loyalty-policy__form">
      <div className="admin-loyalty-policy__rules"><h3>등급별 승급 조건</h3>
        <p>금액과 상품 주문 항목 수를 모두 입력하면 둘 중 하나만 충족해도 승급합니다. 사용하지 않을 조건은 비워두세요.</p>
        <p>상품 주문 항목은 주문서의 상품·옵션별 한 줄이며, 구매 수량의 합계와 다릅니다.</p>
        <p>등급은 SILVER부터 순서대로 사용하며, 상위 등급의 금액·항목 수는 하위 등급보다 커야 합니다.</p>
      </div>
      <div className="admin-loyalty-policy__table-wrap"><table className="admin-loyalty-policy__table"><caption className="sr-only">등급별 사용 여부, 승급 조건과 혜택 설정</caption>
        <colgroup><col style={{ width: '12%' }} /><col style={{ width: '15%' }} /><col style={{ width: '31%' }} /><col style={{ width: '30%' }} /><col style={{ width: '12%' }} /></colgroup>
        <thead><tr><th scope="col">사용 여부</th><th scope="col">등급명</th><th scope="col">등급 조건</th><th scope="col">등급별 혜택</th><th scope="col">수정</th></tr></thead>
        <tbody>{draft.map((tier, index) => <tr key={tier.grade}>
          <td data-label="사용 여부"><label className="admin-loyalty-policy__toggle"><input type="checkbox" checked={tier.enabled} disabled={locked} onChange={event => edit(index, { enabled: event.target.checked })} aria-label={`${tier.grade.toUpperCase()} 등급 사용`} />{tier.enabled ? '사용' : '사용 안 함'}</label></td>
          <th scope="row"><span className={`admin-loyalty-policy__grade admin-loyalty-policy__grade--${tier.grade}`}>{tier.grade.toUpperCase()}</span></th>
          <td data-label="등급 조건">{criterionText({ grade: tier.grade, enabled: tier.enabled, amount: tier.amount ? Number(tier.amount) : null, itemCount: tier.itemCount ? Number(tier.itemCount) : null }) || '조건을 설정해주세요.'}</td>
          <td data-label="등급별 혜택"><ul className="admin-loyalty-policy__coupon-list">{coupons.filter(coupon => coupon.grade === tier.grade).map(coupon => <li key={coupon.code}><Link href={`/admin/sales/coupons?couponCode=${encodeURIComponent(coupon.code)}`}>{coupon.name}<small>{coupon.code} · {{ active: '활성', paused: '중지', archived: '중지' }[coupon.status] ?? coupon.status}</small></Link></li>)}</ul>
            {rewards ? <p>주문 적립: {rewards.gradeEnabled && rewards.baseCreditEnabled ? `${(rewards.gradeRates[tier.grade] ?? 0) / 100}%` : '기본 적립금 정책 적용'} · <Link href="/admin/settings/store-credits#customer-rewards">적립률 설정</Link></p> : null}
            {!coupons.some(coupon => coupon.grade === tier.grade) ? <p>연결된 쿠폰이 없습니다.</p> : null}
            <Link className="admin-loyalty-policy__coupon-add" href={`/admin/sales/coupons/new?grade=${tier.grade}`}>혜택 쿠폰 등록<span className="sr-only"> · {tier.grade.toUpperCase()}</span></Link>
          </td>
          <td><button className="wc-admin-kit__button" type="button" disabled={locked || !tier.enabled} aria-label={`${tier.grade.toUpperCase()} 조건 수정`} onClick={() => openEditor(index)}>수정</button></td>
        </tr>)}</tbody>
      </table></div>
      <div className="admin-loyalty-policy__notice"><p>저장만으로 고객 등급을 일괄 변경하거나 쿠폰을 발급하지 않습니다. 기존 수동 보정의 하한과 보유 쿠폰은 유지됩니다. 등급 사용을 꺼도 유효한 수동 보정 등급은 유지됩니다.</p></div>
      {feedback.error ? <p role="alert" className="admin-loyalty-policy__error">{feedback.error}</p> : null}
      {feedback.message ? <p role="status" className="admin-loyalty-policy__success">{feedback.message}</p> : null}
      <div className="admin-loyalty-policy__actions">
        <button className="wc-admin-kit__button" type="submit" disabled={locked || reading}>{busy ? '저장 중' : '등급 조건 저장'}</button>
        {uncertain ? <button className="wc-admin-kit__button" type="button" disabled={busy} onClick={() => { void save(); }}>같은 요청으로 저장 결과 확인</button>
          : <button className="wc-admin-kit__button" type="button" disabled={busy || reading} onClick={() => { void readLatest(); }}>{reading ? '조회 중' : '최신 정책과 비교'}</button>}
      </div>
    </form>
    {editor ? <CustomerServiceDialog title={`${draft[editor.index].grade.toUpperCase()} 등급 조건·혜택 설정`} onClose={closeEditor} busy={locked}>
      <form className="admin-loyalty-policy__editor" onSubmit={applyEditor}>
        <div className="admin-loyalty-policy__editor-intro"><strong>{draft[editor.index].grade.toUpperCase()}</strong><span>금액 또는 상품 주문 항목 수로 승급 조건을 설정하세요.</span></div>
        <div className="admin-loyalty-policy__condition-fields">
          <label htmlFor={`loyalty-${draft[editor.index].grade}-amount-preset`}>결제 금액 조건
            <select id={`loyalty-${draft[editor.index].grade}-amount-preset`} value={draft[editor.index].amountMode} onChange={event => selectPreset(editor.index, 'amount', event.target.value)}>
              <option value="">사용 안 함</option>{AMOUNT_PRESETS.map(value => <option value={String(value)} key={value}>{value.toLocaleString('ko-KR')}원 이상</option>)}<option value="custom">직접 입력</option>
            </select>
          </label>
          {draft[editor.index].amountMode === 'custom' ? <label htmlFor={`loyalty-${draft[editor.index].grade}-amount`}>결제 금액 직접 입력 (원)<input id={`loyalty-${draft[editor.index].grade}-amount`} inputMode="numeric" maxLength={13} value={draft[editor.index].amount} onChange={event => edit(editor.index, { amount: event.target.value, customAmount: event.target.value })} /></label> : null}
          <p className="admin-loyalty-policy__or">또는</p>
          <label htmlFor={`loyalty-${draft[editor.index].grade}-count-preset`}>상품 주문 항목 수 조건
            <select id={`loyalty-${draft[editor.index].grade}-count-preset`} value={draft[editor.index].itemCountMode} onChange={event => selectPreset(editor.index, 'itemCount', event.target.value)}>
              <option value="">사용 안 함</option>{COUNT_PRESETS.map(value => <option value={String(value)} key={value}>{value}건 이상</option>)}<option value="custom">직접 입력</option>
            </select>
          </label>
          {draft[editor.index].itemCountMode === 'custom' ? <label htmlFor={`loyalty-${draft[editor.index].grade}-count`}>상품 주문 항목 수 직접 입력 (건)<input id={`loyalty-${draft[editor.index].grade}-count`} inputMode="numeric" maxLength={7} value={draft[editor.index].itemCount} onChange={event => edit(editor.index, { itemCount: event.target.value, customItemCount: event.target.value })} /></label> : null}
        </div>
        <p>두 조건을 모두 사용하면 하나만 충족해도 해당 등급을 받을 수 있습니다. 주문 항목 수는 구매 수량 합계와 다릅니다.</p>
        <div className="admin-loyalty-policy__editor-benefits"><h3>연결된 혜택 쿠폰</h3>
          {coupons.filter(coupon => coupon.grade === draft[editor.index].grade).length ? <ul>{coupons.filter(coupon => coupon.grade === draft[editor.index].grade).map(coupon => <li key={coupon.code}>{coupon.name} · {coupon.code}</li>)}</ul> : <p>연결된 쿠폰이 없습니다. 조건 적용 후 등급별 혜택에서 쿠폰을 등록할 수 있습니다.</p>}
        </div>
        {editorError ? <p role="alert" className="admin-loyalty-policy__error">{editorError}</p> : null}
        <div className="admin-loyalty-policy__actions"><button className="wc-admin-kit__button" type="button" onClick={closeEditor}>취소</button><button className="wc-admin-kit__button" type="submit">조건 적용</button></div>
        <p className="admin-loyalty-policy__editor-note">조건 적용 후 전체 화면의 ‘등급 조건 저장’을 눌러야 저장됩니다.</p>
      </form>
    </CustomerServiceDialog> : null}
    {latest ? <section className="admin-loyalty-policy__comparison" aria-label="최신 저장 정책 비교">
      <h3>최신 저장 정책 · 버전 {latest.policy.revision}</h3><p>작성 중인 입력은 그대로 유지했습니다. {savedTime(latest.policy.updatedAt)} KST 저장 기준입니다.</p>
      <dl>{latest.policy.tiers.map(tier => <div key={tier.grade}><dt>{tier.grade.toUpperCase()}</dt><dd>{criterionText(tier)}</dd></div>)}</dl>
      <div className="admin-loyalty-policy__actions"><button className="wc-admin-kit__button" type="button" disabled={locked} onClick={() => applyLatest(false)}>내 입력 유지하고 최신 버전으로 저장 준비</button><button className="wc-admin-kit__button" type="button" disabled={locked} onClick={() => applyLatest(true)}>최신 정책으로 입력 교체</button></div>
    </section> : null}
    <section className="admin-loyalty-policy__sample" aria-label="등급 산정 예시"><h3>입력한 조건으로 등급 확인</h3>
      <p>실적 예시를 입력하면 현재 작성한 조건의 결과를 확인할 수 있습니다. 고객 등급이나 수동 보정에는 영향을 주지 않습니다.</p>
      <div className="admin-loyalty-policy__sample-fields"><label htmlFor="loyalty-sample-amount">실적 금액 (원)<input id="loyalty-sample-amount" inputMode="numeric" maxLength={13} value={sample.amount} onChange={event => setSample({ ...sample, amount: event.target.value })} /></label><label htmlFor="loyalty-sample-count">상품 주문 항목 수 (건)<input id="loyalty-sample-count" inputMode="numeric" maxLength={7} value={sample.itemCount} onChange={event => setSample({ ...sample, itemCount: event.target.value })} /></label></div>
      <p aria-live="polite">{estimated ? <>예상 등급 <strong>{estimated.toUpperCase()}</strong></> : '유효한 등급 조건과 실적 금액·항목 수를 입력해주세요.'}</p>
    </section>
    <section className="admin-loyalty-policy__benefits"><h3>등급 혜택 안내</h3><p>승급할 때 통과한 등급의 쿠폰을 발급합니다. 발급 기간·한도·대상 조건을 따르며 이미 보유한 같은 쿠폰은 다시 발급하지 않습니다. 쿠폰 내용과 연결 등급은 쿠폰 편집에서 관리합니다.</p>
      <p>등급별 주문 적립률은 <Link href="/admin/settings/store-credits#customer-rewards">적립금 정책</Link>에서 설정합니다. 주문 생성 시 등급을 기준으로 최종 적립률을 저장하고 거래확정 때 지급합니다.</p></section>
  </section>;
}
