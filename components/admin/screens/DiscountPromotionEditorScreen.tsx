'use client';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { commitDiscountPromotionAction, previewDiscountPromotionAction, readDiscountPromotionAction } from '@/app/admin/discount-promotion-actions';
import { CategoryDisplayGoodsPicker } from '@/components/admin/CategoryDisplayGoodsPicker';
import { GroupTable, useGoodsGroupSession } from '@/components/admin/GoodsGroupOperation';
import { AdminField, AdminFormGrid, AdminNotice, AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { parseGoodsPricePeriodInput } from '@/lib/admin/goods-price-periods';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { statusTone } from '@/lib/admin/status-tone';
import { isUuid } from '@/lib/uuid';
import {
  DISCOUNT_PROMOTION_GOODS_LIMIT,
  DISCOUNT_PROMOTION_NAME_MAX,
  DISCOUNT_PROMOTION_TARGET_LABELS,
  discountPromotionError,
  discountPromotionHref,
  discountPromotionSkipLabel,
  discountRuleLabel,
  parseDiscountPromotionRequest,
  type DiscountPromotionException,
  type DiscountPromotionPreview,
  type DiscountPromotionPreviewGood,
  type DiscountPromotionReceipt,
  type DiscountPromotionRuleMode,
  type DiscountPromotionTargetKind,
  type DiscountPromotionTargetOptions,
} from '@/lib/admin/discount-promotions';

type ExceptionDraft = { mode: 'default' | 'rate' | 'amount' | 'price' | 'exclude'; value: string };
type PickedGood = { id: string; name: string };
const EXCEPTION_MODES: [ExceptionDraft['mode'], string][] = [['default', '일괄 할인'], ['rate', '다른 할인율 (%)'], ['amount', '다른 할인 금액 (원)'], ['price', '예외가 (원)'], ['exclude', '할인 제외']];
const NOTE = 'text-sm text-muted-foreground';
const CHOICE = 'flex cursor-pointer items-center gap-2 text-sm';
const won = (value: number | null) => value === null ? '판매 옵션 없음' : `${value.toLocaleString('ko-KR')}원`;
const range = (min: number | null, max: number | null) => min === max ? won(min) : `${won(min)} ~ ${won(max)}`;
const kst = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function exceptionsOf(drafts: Record<string, ExceptionDraft>): DiscountPromotionException[] | null {
  const result: DiscountPromotionException[] = [];
  for (const [goodId, draft] of Object.entries(drafts)) {
    if (draft.mode === 'default') continue;
    if (draft.mode === 'exclude') { result.push({ goodId, mode: 'exclude' }); continue; }
    const value = Number(draft.value);
    if (!/^[1-9][0-9]*$/.test(draft.value) || !Number.isSafeInteger(value) || draft.mode === 'rate' && value >= 100) return null;
    result.push({ goodId, mode: draft.mode, value });
  }
  return result.sort((a, b) => a.goodId.localeCompare(b.goodId));
}
function previewOutcome(row: DiscountPromotionPreviewGood) {
  if (!row.skip) return range(row.nextMin, row.nextMax);
  const overlap = row.overlap ? ` (${row.overlap.promotionName ? `프로모션 ‘${row.overlap.promotionName}’` : '개별 할인'} ${kst(row.overlap.startsAt)} ~ ${kst(row.overlap.endsAt)})` : '';
  return `건너뜀 · ${discountPromotionSkipLabel(row.skip)}${overlap}`;
}

/**
 * 새 할인 프로모션(1014-109·110·X37). 이름·기간·대상·일괄 할인을 정하고 비교하면, 대상 상품마다 할인 후 가격과 건너뛸 이유를 먼저 보여 준다.
 * 비교 표에서 한두 상품만 다른 할인율·금액·예외가로 바꾸거나 빼고(다시 계산), 확인한 뒤 등록한다.
 * 등록은 같은 요청번호로만 확정되고(멱등), 응답이 끊기면 결과 조회로 확인한다 — 일괄 변경과 같은 진행 기록을 쓴다.
 */
export function DiscountPromotionEditorScreen({ identity, options, initial }: {
  identity: GoodsGroupIdentity | null; options: DiscountPromotionTargetOptions;
  initial: { kind: DiscountPromotionTargetKind; campaignId: string | null; ipId: string | null; name: string };
}) {
  const session = useGoodsGroupSession(identity?.actorId ?? '', identity?.sessionId ?? null);
  const nameId = useId(), startsId = useId(), endsId = useId(), modeId = useId(), valueId = useId(), campaignSelectId = useId(), ipSelectId = useId();
  const [name, setName] = useState(initial.name), [startsAt, setStartsAt] = useState(''), [endsAt, setEndsAt] = useState('');
  const [kind, setKind] = useState<DiscountPromotionTargetKind>(initial.kind);
  const [campaignId, setCampaignId] = useState(initial.campaignId ?? ''), [ipId, setIpId] = useState(initial.ipId ?? '');
  const [goods, setGoods] = useState<PickedGood[]>([]), [picker, setPicker] = useState(false);
  const [ruleMode, setRuleMode] = useState<DiscountPromotionRuleMode>('rate'), [ruleValue, setRuleValue] = useState('');
  const [preview, setPreview] = useState<DiscountPromotionPreview | null>(null);
  /* 상품별 예외는 비교 표에서 정한다. 대상(종류·기획전·IP·선택 상품)을 바꾸면 비운다 — 새 대상에 없는 상품의 예외는 서버가 거절한다. */
  const [drafts, setDrafts] = useState<Record<string, ExceptionDraft>>({});
  const [acknowledged, setAcknowledged] = useState(false), [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<DiscountPromotionReceipt | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null), [initialized, setInitialized] = useState(false), [storageBroken, setStorageBroken] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const prefix = identity ? `icons:discount-promotion:v1:${identity.actorId}:${identity.sessionId}:` : null;
  function savedOperation() {
    if (!prefix) return null;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index); if (key?.startsWith(prefix)) keys.push(key); }
    for (const key of keys.sort()) {
      const id = localStorage.getItem(key);
      if (!id || !isUuid(id) || key !== `${prefix}${id}`) throw new Error('invalid promotion journal');
      return id;
    }
    return null;
  }
  useEffect(() => {
    let alive = true;
    const load = () => { if (!alive) return; try { setRecovery(savedOperation()); } catch { setStorageBroken(true); } setInitialized(true); };
    queueMicrotask(load);
    const changed = (event: StorageEvent) => { if (prefix && (event.key === null || event.key.startsWith(prefix))) load(); };
    window.addEventListener('storage', changed);
    return () => { alive = false; window.removeEventListener('storage', changed); };
    // 진행 기록 키는 이 화면이 열려 있는 동안 계정·세션으로 고정된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix]);
  useEffect(() => {
    if (!recovery) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [recovery]);

  const locked = !identity || pending || !initialized || storageBroken || session.blocked || Boolean(recovery);
  const exceptions = useMemo(() => exceptionsOf(drafts), [drafts]);
  const previewExceptions = preview ? JSON.stringify([...preview.request.exceptions].sort((a, b) => a.goodId.localeCompare(b.goodId))) : '';
  const stale = Boolean(preview) && (exceptions === null || JSON.stringify(exceptions) !== previewExceptions);
  const selectedCampaign = options.campaigns.find(campaign => campaign.id === campaignId);
  const selectedIp = options.ips.find(ip => ip.id === ipId);

  function request(withExceptions: DiscountPromotionException[]) {
    const period = parseGoodsPricePeriodInput({ state: 'draft', discountPrice: null, startsAt, endsAt });
    if (!name.trim()) return '프로모션 이름을 입력해주세요.';
    if (!period?.startsAt || !period.endsAt) return '한국 시간 기준 시작·종료를 입력해주세요. 종료는 시작보다 늦어야 합니다.';
    const ids = kind === 'campaign' ? (campaignId ? [campaignId] : []) : kind === 'ip' ? (ipId ? [ipId] : []) : goods.map(good => good.id);
    if (!ids.length) return kind === 'goods' ? '할인할 상품을 선택해주세요.' : `할인할 ${kind === 'campaign' ? '기획전' : 'IP'}을 선택해주세요.`;
    const parsed = parseDiscountPromotionRequest({ name: name.trim(), startsAt: period.startsAt, endsAt: period.endsAt, target: { kind, ids },
      rule: { mode: ruleMode, value: Number(ruleValue) }, exceptions: withExceptions });
    return parsed ?? '할인율은 1~99%, 할인 금액은 1원 이상으로 입력해주세요.';
  }
  function compare(withExceptions: DiscountPromotionException[]) {
    if (locked || busy.current || !identity || !session.current()) return;
    const built = request(withExceptions);
    if (typeof built === 'string') { setMessage(built); return; }
    busy.current = true; setMessage(''); startTransition(async () => {
      try {
        const result = await previewDiscountPromotionAction(crypto.randomUUID(), built, identity);
        if (!session.current()) return;
        if ('error' in result) { setMessage(result.error); if (result.authChanged) session.deny(); return; }
        setPreview(result.value); setAcknowledged(false);
        /* 대상이 바뀌어 사라진 상품의 예외는 버린다(서버는 대상 밖 예외를 거절한다). */
        const present = new Set(result.value.goods.map(row => row.id));
        setDrafts(current => Object.fromEntries(Object.entries(current).filter(([goodId]) => present.has(goodId))));
      } catch { if (session.current()) setMessage('대상 상품을 불러오지 못했습니다. 다시 확인해주세요.'); }
      finally { busy.current = false; }
    });
  }
  function accept(result: Awaited<ReturnType<typeof commitDiscountPromotionAction>>) {
    if (!session.current()) return;
    if ('error' in result) { setMessage(result.error); if (result.authChanged) session.deny(); return; }
    const value = result.value;
    if (value.state === 'unresolved') { setMessage('완료 기록이 없습니다. 다시 조회하거나 미처리 요청을 종료해주세요.'); return; }
    try { if (prefix) localStorage.removeItem(`${prefix}${value.operationId}`); setRecovery(savedOperation()); }
    catch { setStorageBroken(true); setMessage('결과는 확인했지만 진행 기록을 정리하지 못했습니다. 화면을 다시 열어주세요.'); return; }
    if (value.state === 'completed') { setReceipt(value); setPreview(null); setMessage(''); return; }
    setPreview(null);
    setMessage(value.state === 'sealed' ? '미처리 요청을 종료했습니다. 최신 내용으로 다시 비교해주세요.' : discountPromotionError(value.error));
  }
  function commit() {
    if (!preview || stale || !acknowledged || locked || busy.current || !identity || !session.current() || !prefix) return;
    try {
      const saved = savedOperation(); if (saved) { setRecovery(saved); setMessage('먼저 이전 요청의 결과를 확인해주세요.'); return; }
      localStorage.setItem(`${prefix}${preview.operationId}`, preview.operationId);
      if (localStorage.getItem(`${prefix}${preview.operationId}`) !== preview.operationId) throw new Error('promotion journal');
    } catch { setStorageBroken(true); setMessage('진행 내역을 보관하지 못해 등록하지 않았습니다. 브라우저 저장공간을 확인해주세요.'); return; }
    setRecovery(preview.operationId); busy.current = true; setMessage(''); startTransition(async () => {
      try { accept(await commitDiscountPromotionAction(preview.operationId, identity)); }
      catch { if (session.current()) setMessage('결과가 불명확합니다. 같은 요청의 결과를 조회해주세요.'); }
      finally { busy.current = false; }
    });
  }
  function recover(seal = false) {
    if (!recovery || pending || busy.current || !identity || !session.current()) return;
    busy.current = true; startTransition(async () => {
      try { accept(await readDiscountPromotionAction(recovery, identity, seal)); }
      catch { if (session.current()) setMessage('처리 결과를 불러오지 못했습니다. 다시 조회해주세요.'); }
      finally { busy.current = false; }
    });
  }
  function changeDraft(goodId: string, next: Partial<ExceptionDraft>) {
    setDrafts(current => ({ ...current, [goodId]: { ...(current[goodId] ?? { mode: 'default', value: '' }), ...next } }));
    setAcknowledged(false);
  }

  const status = <>{message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
    {recovery ? <AdminNotice role="alert" title="처리 결과 확인이 남아 있습니다." tone="warning"><p>재실행하지 않고 저장된 결과를 확인합니다.</p><div className="mt-2 flex flex-wrap items-center gap-2">
      <Button disabled={pending || session.blocked} onClick={() => recover()} size="sm" type="button">처리 결과 조회</Button>
      <Button disabled={pending || session.blocked} onClick={() => recover(true)} size="sm" type="button" variant="outline">미처리 요청 종료</Button></div></AdminNotice> : null}
    {!identity || session.blocked ? <p className="text-sm text-destructive" role="alert">로그인 계정 또는 세션을 확인하지 못했습니다. 화면을 다시 열어주세요.</p> : null}
    {storageBroken ? <p className="text-sm text-destructive" role="alert">진행 기록을 확인하지 못했습니다. 브라우저 저장공간을 확인하고 화면을 다시 열어주세요.</p> : null}</>;

  if (receipt) {
    return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="discount-promotion-new">
      <AdminPageHeader title="새 할인 프로모션" />
      <AdminNotice title="할인 프로모션을 등록했습니다" tone="success"><p>상품 {receipt.goodsCount.toLocaleString('ko-KR')}개(옵션 {receipt.periodCount.toLocaleString('ko-KR')}개)에 할인을 걸었습니다.{receipt.skipped.length ? ` 건너뛴 상품 ${receipt.skipped.length.toLocaleString('ko-KR')}개는 아래와 같습니다.` : ''}</p>
        <div className="mt-2 flex flex-wrap gap-2"><Link className={buttonVariants({ size: 'sm' })} data-slot="button" href={discountPromotionHref(receipt.operationId)}>프로모션 상세 보기</Link></div></AdminNotice>
      {receipt.skipped.length ? <ul className="flex max-h-72 list-disc flex-col gap-1 overflow-auto rounded-lg border px-8 py-3 text-sm">{receipt.skipped.map(row => <li key={row.id}>{row.name}<small className="block text-xs text-muted-foreground">{row.code ?? row.id} · {discountPromotionSkipLabel(row.reason)}</small></li>)}</ul> : null}
    </div>;
  }

  const applied = preview ? preview.goods.filter(row => !row.skip).length : 0;
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="discount-promotion-new">
    <AdminPageHeader title="새 할인 프로모션" description="기획전·IP·선택 상품에 같은 할인을 한 번에 겁니다. 할인은 기존 기간 할인으로 저장되어 상품 상세·장바구니·주문에 같은 가격이 쓰이고, 한 상품에는 한 시점에 할인가가 하나만 적용됩니다." />
    {!preview ? <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); compare(exceptions ?? []); }}>
      <fieldset className="flex min-w-0 flex-col gap-4" disabled={locked}><legend className="sr-only">할인 프로모션 설정</legend>
        <AdminSectionCard title="기본 정보">
          <AdminFormGrid>
            <AdminField inputId={nameId} label="프로모션 이름"><Input id={nameId} maxLength={DISCOUNT_PROMOTION_NAME_MAX} onChange={event => setName(event.target.value)} placeholder="예: 오픈 기획전 10%" required value={name} /></AdminField>
            <div />
            <AdminField hint="한국 시간 기준입니다. 이미 지난 기간은 등록할 수 없습니다." inputId={startsId} label="할인 시작"><Input id={startsId} onChange={event => setStartsAt(event.target.value)} required type="datetime-local" value={startsAt} /></AdminField>
            <AdminField inputId={endsId} label="할인 종료"><Input id={endsId} onChange={event => setEndsAt(event.target.value)} required type="datetime-local" value={endsAt} /></AdminField>
          </AdminFormGrid>
        </AdminSectionCard>
        <AdminSectionCard summary="대상 상품은 비교할 때 고정됩니다. 보관한 상품은 할인하지 않습니다." title="대상">
          <fieldset className="flex flex-wrap gap-4"><legend className="sr-only">대상 종류</legend>
            {(['campaign', 'ip', 'goods'] as DiscountPromotionTargetKind[]).map(value => <label className={CHOICE} key={value}><input checked={kind === value} name="target-kind" onChange={() => { setKind(value); setDrafts({}); }} type="radio" value={value} />{DISCOUNT_PROMOTION_TARGET_LABELS[value]}</label>)}
          </fieldset>
          {kind === 'campaign' ? <AdminField hint="기획전 본문 상품 묶음 블록의 상품이 대상입니다(블록 순서대로). 블록을 바꿨다면 캠페인을 먼저 저장하세요." inputId={campaignSelectId} label="기획전(캠페인)">
            <AdminSelect id={campaignSelectId} onChange={event => { setCampaignId(event.target.value); setDrafts({}); }} value={campaignId} wrapperClassName="w-full">
              <option value="">기획전을 선택하세요</option>
              {options.campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.title} · 상품 {campaign.goodsCount}개 ({campaign.id})</option>)}
            </AdminSelect></AdminField> : null}
          {kind === 'campaign' && selectedCampaign && !selectedCampaign.goodsCount ? <AdminNotice tone="warning">이 기획전 본문에는 상품 묶음 블록의 상품이 없습니다. 캠페인 관리에서 상품 묶음을 먼저 고르세요.</AdminNotice> : null}
          {kind === 'ip' ? <AdminField hint="그 IP의 보관하지 않은 전체 상품이 대상입니다." inputId={ipSelectId} label="IP">
            <AdminSelect id={ipSelectId} onChange={event => { setIpId(event.target.value); setDrafts({}); }} value={ipId} wrapperClassName="w-full">
              <option value="">IP를 선택하세요</option>
              {options.ips.map(ip => <option key={ip.id} value={ip.id}>{ip.title} · 상품 {ip.goodsCount.toLocaleString('ko-KR')}개</option>)}
            </AdminSelect></AdminField> : null}
          {kind === 'ip' && selectedIp && selectedIp.goodsCount > DISCOUNT_PROMOTION_GOODS_LIMIT ? <AdminNotice tone="warning">상품이 {DISCOUNT_PROMOTION_GOODS_LIMIT.toLocaleString('ko-KR')}개를 넘어 한 프로모션으로 걸 수 없습니다. 선택 상품으로 나눠 주세요.</AdminNotice> : null}
          {kind === 'goods' ? <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2"><Button onClick={() => setPicker(true)} size="sm" type="button" variant="outline">상품 선택</Button>
              <span className="text-sm tabular-nums">선택 {goods.length.toLocaleString('ko-KR')} / {DISCOUNT_PROMOTION_GOODS_LIMIT.toLocaleString('ko-KR')}개</span>
              {goods.length ? <Button onClick={() => { setGoods([]); setDrafts({}); }} size="sm" type="button" variant="ghost">선택 비우기</Button> : null}</div>
            <p className={NOTE}>검색으로 고르거나, 선택 창의 ‘여러 상품 한 번에 추가’에 상품 URL·상품코드를 여러 줄로 붙이거나 엑셀 한 열을 올려 담습니다.</p>
            {goods.length ? <ul className="flex max-h-56 flex-col overflow-auto rounded-lg border text-sm">{goods.map(good => <li className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0" key={good.id}>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{good.name}<small className="ml-1 text-xs text-muted-foreground">{good.id}</small></span>
              <Button aria-label={`${good.name} 빼기`} onClick={() => { setGoods(current => current.filter(item => item.id !== good.id)); setDrafts(current => Object.fromEntries(Object.entries(current).filter(([goodId]) => goodId !== good.id))); }} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" /></Button></li>)}</ul> : null}
          </div> : null}
        </AdminSectionCard>
        <AdminSectionCard summary="모든 대상 상품의 판매 중인 옵션에 같은 율·금액을 적용합니다. 율 계산의 원 미만은 버립니다. 한두 상품만 다르게 하려면 비교 표에서 그 상품만 바꿉니다." title="일괄 할인">
          <AdminFormGrid>
            <AdminField inputId={modeId} label="할인 방식"><AdminSelect id={modeId} onChange={event => setRuleMode(event.target.value as DiscountPromotionRuleMode)} value={ruleMode} wrapperClassName="w-full">
              <option value="rate">정률 할인 (%)</option><option value="amount">정액 할인 (원)</option></AdminSelect></AdminField>
            <AdminField inputId={valueId} label={ruleMode === 'rate' ? '할인율 (%)' : '할인 금액 (원)'}><Input className="text-right tabular-nums" id={valueId} max={ruleMode === 'rate' ? 99 : 2147483647} min={1} onChange={event => setRuleValue(event.target.value)} required step={1} type="number" value={ruleValue} /></AdminField>
          </AdminFormGrid>
        </AdminSectionCard>
        <div className="flex flex-wrap justify-end gap-2"><Button type="submit">대상·할인 확인</Button></div>
      </fieldset>
    </form> : <section aria-label="할인 프로모션 비교" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{preview.request.name}</h3>
        <p className="text-sm tabular-nums">{kst(preview.request.startsAt)} ~ {kst(preview.request.endsAt)} (한국 시간) · {DISCOUNT_PROMOTION_TARGET_LABELS[preview.target.kind]}{preview.target.label ? ` · ${preview.target.label}` : ''} · 일괄 {discountRuleLabel(preview.request.rule)}</p>
        <p className="text-sm tabular-nums">대상 {preview.goods.length.toLocaleString('ko-KR')}개 · 적용 {applied.toLocaleString('ko-KR')}개 · 건너뜀 {(preview.goods.length - applied).toLocaleString('ko-KR')}개 · 예외 {preview.request.exceptions.length.toLocaleString('ko-KR')}개</p>
      </div>
      <GroupTable label="할인 프로모션 대상" layout="fixed"><TableHeader><TableRow><TableHead className="w-[32%]">상품명·판매자상품코드</TableHead><TableHead className="w-[16%]">현재 판매가</TableHead><TableHead className="w-[26%]">할인 규칙</TableHead><TableHead>할인 후</TableHead></TableRow></TableHeader>
        <TableBody>{preview.goods.map(row => {
          const draft = drafts[row.id] ?? { mode: 'default', value: '' };
          return <TableRow className="data-[skipped]:text-muted-foreground" data-skipped={row.skip ? 'true' : undefined} key={row.id}>
            <TableCell className="whitespace-normal wrap-anywhere">{row.name}<small className="block text-xs text-muted-foreground">{row.code ?? row.id}{row.published ? '' : ' · 비공개'}</small></TableCell>
            <TableCell className="whitespace-normal tabular-nums">{range(row.priceMin, row.priceMax)}</TableCell>
            <TableCell className="whitespace-normal">{row.archived ? '—' : <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <AdminSelect aria-label={`${row.name} 할인 규칙`} disabled={locked} onChange={event => changeDraft(row.id, { mode: event.target.value as ExceptionDraft['mode'] })} value={draft.mode} wrapperClassName="min-w-0 flex-1">
                {EXCEPTION_MODES.map(([value, label]) => <option key={value} value={value}>{value === 'default' ? `${label} (${discountRuleLabel(preview.request.rule)})` : label}</option>)}</AdminSelect>
              {draft.mode === 'rate' || draft.mode === 'amount' || draft.mode === 'price' ? <Input aria-label={`${row.name} ${draft.mode === 'rate' ? '할인율' : draft.mode === 'amount' ? '할인 금액' : '예외가'}`} className="w-24 text-right tabular-nums" disabled={locked}
                max={draft.mode === 'rate' ? 99 : 2147483647} min={1} onChange={event => changeDraft(row.id, { value: event.target.value })} step={1} type="number" value={draft.value} /> : null}
            </div>}</TableCell>
            <TableCell className="whitespace-normal">{previewOutcome(row)}{row.rule.source === 'exception' && !row.skip ? <small className="block text-xs text-muted-foreground">예외 · {discountRuleLabel(row.rule)}</small> : null}</TableCell>
          </TableRow>;
        })}</TableBody></GroupTable>
      {stale ? <AdminNotice tone="warning">{exceptions === null ? '예외 할인율은 1~99%, 금액·예외가는 1원 이상으로 입력해주세요.' : '바꾼 예외가 아직 계산되지 않았습니다. 다시 계산을 눌러 할인 후 가격을 확인해주세요.'}</AdminNotice> : null}
      <p className={NOTE}>예외가는 기본 판매가를 그 가격으로 내리는 금액을 옵션마다 같게 뺍니다. 비교 이후 상품의 옵션·가격·기간 할인이 바뀌면 등록을 중단하고(판매로 인한 재고 변동은 영향 없음), 비교 결과는 15분 동안 유효합니다.</p>
      <label className={CHOICE}><input checked={acknowledged} disabled={locked || stale} onChange={event => setAcknowledged(event.target.checked)} type="checkbox" />대상 상품과 할인 후 가격을 확인했습니다.</label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={locked} onClick={() => { setPreview(null); setAcknowledged(false); }} type="button" variant="outline">입력으로 돌아가기</Button>
        <Button disabled={locked || !stale || exceptions === null} onClick={() => { if (exceptions) compare(exceptions); }} type="button" variant="outline">다시 계산</Button>
        <Button disabled={locked || stale || !acknowledged} onClick={commit} type="button">프로모션 등록</Button>
      </div>
      {preview.goods.some(row => row.skip) ? <p className={NOTE}><AdminStatusBadge tone={statusTone('goodReference', 'blocked')}>건너뜀</AdminStatusBadge> 건너뛴 상품은 할인하지 않고 프로모션 상세에 이유와 함께 남습니다.</p> : null}
    </section>}
    {status}
    {picker ? <CategoryDisplayGoodsPicker limit={DISCOUNT_PROMOTION_GOODS_LIMIT} onApply={(ids, rows) => {
      const names = new Map([...goods.map(good => [good.id, good.name] as const), ...rows.map(row => [row.id, row.name] as const)]);
      /* 대상이 바뀌면 빠진 상품의 예외도 버린다(서버는 대상 밖 예외를 거절한다). */
      setGoods(ids.map(id => ({ id, name: names.get(id) ?? id }))); setDrafts(current => Object.fromEntries(Object.entries(current).filter(([goodId]) => ids.includes(goodId)))); setPicker(false);
    }} onClose={() => setPicker(false)} selected={goods.map(good => good.id)} title="할인할 상품 선택" /> : null}
  </div>;
}
