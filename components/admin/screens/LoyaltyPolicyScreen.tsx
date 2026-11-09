'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { readLoyaltyPolicyAction, saveLoyaltyPolicyAction } from '@/app/admin/loyalty-policy-actions';
import { parseLoyaltyCriteria, type ConfigurableGrade, type LoyaltyCriterion, type LoyaltyPolicy, type LoyaltyPolicyData } from '@/lib/loyalty-policy';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import type { CustomerRewardPolicy } from '@/lib/admin/customer-rewards';
import { Check, Plus } from 'lucide-react';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ACTIONS, CHECK_LABEL, FIELD_HINT, FIELD_LABEL, INFO_PANEL, NOTE, TABLE_BOX } from '@/components/admin/settings-kit';
import { AdminNotice } from '@/components/admin/console/AdminKit';

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

  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="loyalty-policy">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1"><h2 className="text-lg leading-tight font-semibold tracking-tight">고객등급 설정</h2><p className="max-w-prose text-sm text-muted-foreground">WELCOME은 기본 등급입니다. 최근 90일의 결제 확정·취소 제외 실적으로 SILVER, GOLD, PLATINUM을 산정합니다.</p></div>
      <p className="text-xs text-muted-foreground tabular-nums">저장 버전 {base.revision} · {savedTime(base.updatedAt)} KST</p>
    </header>
    <form onSubmit={save} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground sm:p-5">
      <div className="flex flex-col gap-1"><h3 className="text-base font-medium">등급별 승급 조건</h3>
        <p className={NOTE}>금액과 상품 주문 항목 수를 모두 입력하면 둘 중 하나만 충족해도 승급합니다. 사용하지 않을 조건은 비워두세요.</p>
        <p className={NOTE}>상품 주문 항목은 주문서의 상품·옵션별 한 줄이며, 구매 수량의 합계와 다릅니다.</p>
        <p className={NOTE}>등급은 SILVER부터 순서대로 사용하며, 상위 등급의 금액·항목 수는 하위 등급보다 커야 합니다.</p>
      </div>
      <div className={TABLE_BOX}><Table className="min-w-[47.5rem] table-fixed"><caption className="sr-only">등급별 사용 여부, 승급 조건과 혜택 설정</caption>
        <colgroup><col style={{ width: '12%' }} /><col style={{ width: '15%' }} /><col style={{ width: '31%' }} /><col style={{ width: '30%' }} /><col style={{ width: '12%' }} /></colgroup>
        <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead scope="col">사용 여부</TableHead><TableHead scope="col">등급명</TableHead><TableHead scope="col">등급 조건</TableHead><TableHead scope="col">등급별 혜택</TableHead><TableHead scope="col">수정</TableHead></TableRow></TableHeader>
        <TableBody>{draft.map((tier, index) => <TableRow className="hover:bg-transparent" key={tier.grade}>
          <TableCell className="align-top whitespace-normal" data-label="사용 여부"><label className={CHECK_LABEL}><input type="checkbox" checked={tier.enabled} disabled={locked} onChange={event => edit(index, { enabled: event.target.checked })} aria-label={`${tier.grade.toUpperCase()} 등급 사용`} />{tier.enabled ? '사용' : '사용 안 함'}</label></TableCell>
          <TableHead className="h-auto py-3 align-top" scope="row"><Badge data-grade={tier.grade} variant="outline">{tier.grade.toUpperCase()}</Badge></TableHead>
          <TableCell className="align-top whitespace-normal" data-label="등급 조건">{criterionText({ grade: tier.grade, enabled: tier.enabled, amount: tier.amount ? Number(tier.amount) : null, itemCount: tier.itemCount ? Number(tier.itemCount) : null }) || '조건을 설정해주세요.'}</TableCell>
          <TableCell className="align-top whitespace-normal" data-label="등급별 혜택"><div className="flex min-w-0 flex-col gap-1.5"><ul className="flex flex-col gap-1">{coupons.filter(coupon => coupon.grade === tier.grade).map(coupon => <li key={coupon.code}><Link className="font-medium underline-offset-4 hover:underline" href={`/admin/sales/coupons?couponCode=${encodeURIComponent(coupon.code)}`}>{coupon.name}<small className={`block ${FIELD_HINT}`}>{coupon.code} · {{ active: '활성', paused: '중지', archived: '중지' }[coupon.status] ?? coupon.status}</small></Link></li>)}</ul>
            {rewards ? <p className="text-xs text-muted-foreground">주문 적립: {rewards.gradeEnabled && rewards.baseCreditEnabled ? `${(rewards.gradeRates[tier.grade] ?? 0) / 100}%` : '기본 적립금 정책 적용'} · <Link className="font-medium text-foreground underline underline-offset-4" href="/admin/settings/store-credits#customer-rewards">적립률 설정</Link></p> : null}
            {!coupons.some(coupon => coupon.grade === tier.grade) ? <p className="text-xs text-muted-foreground">연결된 쿠폰이 없습니다.</p> : null}
            <Link className={`${buttonVariants({ variant: 'outline', size: 'xs' })} w-fit`} data-slot="button" href={`/admin/sales/coupons/new?grade=${tier.grade}`}><Plus aria-hidden="true" />혜택 쿠폰 등록<span className="sr-only"> · {tier.grade.toUpperCase()}</span></Link>
          </div></TableCell>
          <TableCell className="align-top"><Button aria-label={`${tier.grade.toUpperCase()} 조건 수정`} disabled={locked || !tier.enabled} onClick={() => openEditor(index)} size="sm" type="button" variant="outline">수정</Button></TableCell>
        </TableRow>)}</TableBody>
      </Table></div>
      <AdminNotice tone="info">저장만으로 고객 등급을 일괄 변경하거나 쿠폰을 발급하지 않습니다. 기존 수동 보정의 하한과 보유 쿠폰은 유지됩니다. 등급 사용을 꺼도 유효한 수동 보정 등급은 유지됩니다.</AdminNotice>
      {feedback.error ? <AdminNotice role="alert" tone="danger">{feedback.error}</AdminNotice> : null}
      {feedback.message ? <AdminNotice role="status" tone="success">{feedback.message}</AdminNotice> : null}
      <div className={`${ACTIONS} border-t pt-4`}>
        <Button disabled={locked || reading} type="submit"><Check aria-hidden="true" />{busy ? '저장 중' : '등급 조건 저장'}</Button>
        {uncertain ? <Button disabled={busy} onClick={() => { void save(); }} type="button" variant="outline">같은 요청으로 저장 결과 확인</Button>
          : <Button disabled={busy || reading} onClick={() => { void readLatest(); }} type="button" variant="outline">{reading ? '조회 중' : '최신 정책과 비교'}</Button>}
      </div>
    </form>
    {editor ? <CustomerServiceDialog title={`${draft[editor.index].grade.toUpperCase()} 등급 조건·혜택 설정`} onClose={closeEditor} busy={locked}>
      <form className="flex min-w-0 flex-col gap-4" data-loyalty-editor="" onSubmit={applyEditor}>
        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{draft[editor.index].grade.toUpperCase()}</Badge><span className={NOTE}>금액 또는 상품 주문 항목 수로 승급 조건을 설정하세요.</span></div>
        <div className="flex min-w-0 flex-col gap-3">
          <label className={FIELD_LABEL} htmlFor={`loyalty-${draft[editor.index].grade}-amount-preset`}>결제 금액 조건
            <NativeSelect className="w-full" id={`loyalty-${draft[editor.index].grade}-amount-preset`} value={draft[editor.index].amountMode} onChange={event => selectPreset(editor.index, 'amount', event.target.value)}>
              <option value="">사용 안 함</option>{AMOUNT_PRESETS.map(value => <option value={String(value)} key={value}>{value.toLocaleString('ko-KR')}원 이상</option>)}<option value="custom">직접 입력</option>
            </NativeSelect>
          </label>
          {draft[editor.index].amountMode === 'custom' ? <label className={FIELD_LABEL} htmlFor={`loyalty-${draft[editor.index].grade}-amount`}>결제 금액 직접 입력 (원)<Input id={`loyalty-${draft[editor.index].grade}-amount`} inputMode="numeric" maxLength={13} value={draft[editor.index].amount} onChange={event => edit(editor.index, { amount: event.target.value, customAmount: event.target.value })} /></label> : null}
          <p className="text-center text-xs font-medium text-muted-foreground">또는</p>
          <label className={FIELD_LABEL} htmlFor={`loyalty-${draft[editor.index].grade}-count-preset`}>상품 주문 항목 수 조건
            <NativeSelect className="w-full" id={`loyalty-${draft[editor.index].grade}-count-preset`} value={draft[editor.index].itemCountMode} onChange={event => selectPreset(editor.index, 'itemCount', event.target.value)}>
              <option value="">사용 안 함</option>{COUNT_PRESETS.map(value => <option value={String(value)} key={value}>{value}건 이상</option>)}<option value="custom">직접 입력</option>
            </NativeSelect>
          </label>
          {draft[editor.index].itemCountMode === 'custom' ? <label className={FIELD_LABEL} htmlFor={`loyalty-${draft[editor.index].grade}-count`}>상품 주문 항목 수 직접 입력 (건)<Input id={`loyalty-${draft[editor.index].grade}-count`} inputMode="numeric" maxLength={7} value={draft[editor.index].itemCount} onChange={event => edit(editor.index, { itemCount: event.target.value, customItemCount: event.target.value })} /></label> : null}
        </div>
        <p className={NOTE}>두 조건을 모두 사용하면 하나만 충족해도 해당 등급을 받을 수 있습니다. 주문 항목 수는 구매 수량 합계와 다릅니다.</p>
        <div className={INFO_PANEL}><h3 className="font-medium">연결된 혜택 쿠폰</h3>
          {coupons.filter(coupon => coupon.grade === draft[editor.index].grade).length ? <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">{coupons.filter(coupon => coupon.grade === draft[editor.index].grade).map(coupon => <li key={coupon.code}>{coupon.name} · {coupon.code}</li>)}</ul> : <p className="text-muted-foreground">연결된 쿠폰이 없습니다. 조건 적용 후 등급별 혜택에서 쿠폰을 등록할 수 있습니다.</p>}
        </div>
        {editorError ? <AdminNotice role="alert" tone="danger">{editorError}</AdminNotice> : null}
        <div className={`${ACTIONS} justify-end border-t pt-4`}><Button onClick={closeEditor} type="button" variant="outline">취소</Button><Button type="submit">조건 적용</Button></div>
        <p className="text-xs text-muted-foreground">조건 적용 후 전체 화면의 ‘등급 조건 저장’을 눌러야 저장됩니다.</p>
      </form>
    </CustomerServiceDialog> : null}
    {latest ? <section aria-label="최신 저장 정책 비교" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground sm:p-5">
      <h3 className="text-base font-medium">최신 저장 정책 · 버전 {latest.policy.revision}</h3><p className={NOTE}>작성 중인 입력은 그대로 유지했습니다. {savedTime(latest.policy.updatedAt)} KST 저장 기준입니다.</p>
      <dl className="grid gap-2">{latest.policy.tiers.map(tier => <div className="grid gap-1 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-3" key={tier.grade}><dt className="font-medium">{tier.grade.toUpperCase()}</dt><dd className="text-muted-foreground">{criterionText(tier)}</dd></div>)}</dl>
      <div className={ACTIONS}><Button disabled={locked} onClick={() => applyLatest(false)} type="button">내 입력 유지하고 최신 버전으로 저장 준비</Button><Button disabled={locked} onClick={() => applyLatest(true)} type="button" variant="outline">최신 정책으로 입력 교체</Button></div>
    </section> : null}
    <section aria-label="등급 산정 예시" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground sm:p-5"><h3 className="text-base font-medium">입력한 조건으로 등급 확인</h3>
      <p className={NOTE}>실적 예시를 입력하면 현재 작성한 조건의 결과를 확인할 수 있습니다. 고객 등급이나 수동 보정에는 영향을 주지 않습니다.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className={FIELD_LABEL} htmlFor="loyalty-sample-amount">실적 금액 (원)<Input id="loyalty-sample-amount" inputMode="numeric" maxLength={13} value={sample.amount} onChange={event => setSample({ ...sample, amount: event.target.value })} /></label><label className={FIELD_LABEL} htmlFor="loyalty-sample-count">상품 주문 항목 수 (건)<Input id="loyalty-sample-count" inputMode="numeric" maxLength={7} value={sample.itemCount} onChange={event => setSample({ ...sample, itemCount: event.target.value })} /></label></div>
      <p aria-live="polite" className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm">{estimated ? <>예상 등급 <strong className="font-semibold">{estimated.toUpperCase()}</strong></> : '유효한 등급 조건과 실적 금액·항목 수를 입력해주세요.'}</p>
    </section>
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground sm:p-5"><h3 className="text-base font-medium">등급 혜택 안내</h3><p className={NOTE}>승급할 때 통과한 등급의 쿠폰을 발급합니다. 발급 기간·한도·대상 조건을 따르며 이미 보유한 같은 쿠폰은 다시 발급하지 않습니다. 쿠폰 내용과 연결 등급은 쿠폰 편집에서 관리합니다.</p>
      <p className={NOTE}>등급별 주문 적립률은 <Link className="font-medium text-foreground underline underline-offset-4" href="/admin/settings/store-credits#customer-rewards">적립금 정책</Link>에서 설정합니다. 주문 생성 시 등급을 기준으로 최종 적립률을 저장하고 거래확정 때 지급합니다.</p></section>
  </div>;
}
