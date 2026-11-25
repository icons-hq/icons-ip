'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { previewGoodsBulkAction, commitGoodsBulkAction, readGoodsBulkAction } from '@/app/admin/goods-bulk-actions';
import { GOODS_BULK_IP_LIMIT, GOODS_BULK_LABELS, GOODS_BULK_RECOVER_LABEL, GOODS_BULK_SEAL_LABEL, GOODS_BULK_STOCK_LABELS, GOODS_BULK_UNCERTAIN, GOODS_BULK_UNRESOLVED,
  goodsBulkError, goodsBulkFormValues, goodsBulkModeUnit, goodsBulkPriceConfirmation, goodsBulkShippingHref, goodsBulkSkipLabel, parseGoodsBulkRequest,
  type GoodsBulkCommand, type GoodsBulkFormFields, type GoodsBulkGood, type GoodsBulkKind, type GoodsBulkPreview, type GoodsBulkReceipt, type GoodsBulkSkipped } from '@/lib/admin/goods-bulk';
import { isUuid } from '@/lib/uuid';
import { adminConfirm } from '@/lib/admin/confirm';
import { toKstDateTimeInput } from '@/lib/admin/goods-price-periods';
import { kstInputRangeLabel } from '@/lib/admin/goods-sale-period';
import { newDiscountPromotionHref } from '@/lib/admin/discount-promotions';
import type { GoodsGroupIdentity, GoodsGroupResult } from '@/lib/admin/goods-groups';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { GroupTable, useGoodsGroupSession } from './GoodsGroupOperation';
import { GoodAmountField, GoodChoiceCard, GoodChoiceCards, GoodReadback } from './GoodEditorParts';
import { AdminNotice } from './console/AdminKit';
import { AdminSelect } from './console/AdminSelect';
import { Button, buttonVariants } from './kit/ui/button';
import { Input } from './kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './kit/ui/table';

const money = (value: number | null) => value === null ? '사용 옵션 없음' : `${value.toLocaleString('ko-KR')}원`;
const range = (min: number | null, max: number | null) => min === max ? money(min) : `${money(min)} ~ ${money(max)}`;
function status(row: GoodsBulkGood) { return row.archived ? '보관' : row.published ? '공개' : '초안'; }
const kstDate = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
/** '12월 1일 10:00부터 7일 23:59까지'. 저장된 시각(UTC)을 KST 입력값으로 옮겨 입력 되읽기와 같은 말로 쓴다. */
function periodText(startsAt: unknown, endsAt: unknown) {
  return kstInputRangeLabel(toKstDateTimeInput(typeof startsAt === 'string' ? startsAt : null), toKstDateTimeInput(typeof endsAt === 'string' ? endsAt : null))?.text ?? null;
}
/* 할인 중지로 꺼질 진행·예정 할인을 상품별로 보여 준다(개별로 걸어 둔 할인 포함). */
function activeDiscountLabel(row: GoodsBulkGood) {
  const value = row.discounts;
  if (!value) return '진행·예정 할인 없음';
  return `할인 ${value.count}건 · ${range(value.minPrice, value.maxPrice)} · ${kstDate(value.startsAt)} ~ ${kstDate(value.endsAt)}`;
}
/** 표의 '현재' 칸. 무엇을 바꾸는 명령인지에 맞춰 지금 값을 보인다. */
function before(row: GoodsBulkGood, command: GoodsBulkCommand) {
  if (command === 'discount_stop') return activeDiscountLabel(row);
  if (command === 'price' || command === 'discount') return range(row.priceMin, row.priceMax);
  if (command === 'start' || command === 'stop') return row.stock ? GOODS_BULK_STOCK_LABELS[row.stock] : row.stopped ? GOODS_BULK_STOCK_LABELS.soldout : GOODS_BULK_STOCK_LABELS.ok;
  if (command === 'period' && row.saleStartsAt !== undefined) return periodText(row.saleStartsAt, row.saleEndsAt) ?? '기간 없음';
  return status(row);
}
/** 표의 '변경 후' 칸. 건너뛰는 상품은 이유를 적는다. */
function after(row: GoodsBulkGood, preview: GoodsBulkPreview) {
  const { command, values } = preview.request;
  if (row.skip) return `건너뜀 · ${goodsBulkSkipLabel(row.skip, command)}`;
  if (command === 'publish') return '공개'; if (command === 'unpublish' || command === 'restore') return '초안';
  if (command === 'start') return GOODS_BULK_STOCK_LABELS.ok; if (command === 'stop') return GOODS_BULK_STOCK_LABELS.soldout;
  if (command === 'archive') return '보관';
  if (command === 'price' || command === 'discount') return range(row.nextMin, row.nextMax);
  if (command === 'period') return periodText(values.startsAt, values.endsAt) ?? '기간 없음';
  if (command === 'discount_stop') return '할인 중지';
  return GOODS_BULK_LABELS[command];
}
const FIELD = 'flex min-w-0 flex-col gap-2 text-sm font-medium';
const NOTE = 'text-sm text-muted-foreground';
const CHECK = 'flex cursor-pointer items-center gap-2 text-sm';
const MENU_ITEM = 'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50';

/*
 * 하나를 고르면 그에 필요한 입력만 연다(화면 규칙 '글보다 화면' 2, 규칙 5). 반대 동작을 드롭다운에 숨기지 않고 창 첫 줄의 선택 카드로 둔다.
 * 묶음: 전시상태(공개로·초안으로), 판매상태(판매중으로·판매중지로), 기간 할인(걸기·중지). 나머지는 명령 하나짜리 창이다.
 */
const CHOICES: { title: string; commands: [GoodsBulkCommand, string][] }[] = [
  { title: '전시상태 변경', commands: [['publish', '고객 화면에 보입니다.'], ['unpublish', '고객 화면에서 내립니다.']] },
  { title: '판매상태 변경', commands: [['start', '판매중지인 상품을 다시 팝니다.'], ['stop', '고객 화면에 품절로 보입니다.']] },
  { title: '기간 할인', commands: [['discount', '사용 중인 모든 옵션에 같은 기간으로 겁니다.'], ['discount_stop', '진행 중이거나 예정된 기간 할인을 모두 멈춥니다.']] },
];
const choiceOf = (command: GoodsBulkCommand) => CHOICES.find(group => group.commands.some(([value]) => value === command));
/** 창 제목. 선택 카드가 있는 묶음은 묶음 이름, 나머지는 명령 이름이다. */
export function goodsBulkDialogTitle(command: GoodsBulkCommand) { return choiceOf(command)?.title ?? GOODS_BULK_LABELS[command]; }
const PRICE_MODES: [string, string][] = [['set', '이 금액으로 맞추기'], ['increase', '금액만큼 올리기'], ['decrease', '금액만큼 내리기'], ['percent_increase', '비율만큼 올리기'], ['percent_decrease', '비율만큼 내리기']];
const DISCOUNT_MODES: [string, string][] = [['amount', '금액만큼 할인'], ['rate', '비율만큼 할인']];
export function goodsBulkInitialFields(command: GoodsBulkCommand): GoodsBulkFormFields {
  return { mode: command === 'price' ? 'set' : 'amount', value: '', periodMode: 'range', startsAt: '', endsAt: '' };
}

/** 무엇을 바꾸는지 한 줄. 개수 제한 같은 설명은 선택 막대가 이미 막고 있어 적지 않는다. */
function targetLine(kind: GoodsBulkKind, count: number, ipTitle: string | undefined) {
  if (kind === 'ip') return `${ipTitle ?? '이름 없는 IP'}의 보관하지 않은 상품 전체(최대 ${GOODS_BULK_IP_LIMIT.toLocaleString('ko-KR')}개)`;
  return kind === 'groups' ? `고른 그룹 ${count}개에 속한 상품` : `고른 상품 ${count}개`;
}

/**
 * 일괄 변경 설정. 훅이 없는 순수 부품이다 — 입력값(`fields`)은 창이 들고 있어 [다시 입력]으로 돌아와도 남는다.
 * 금액 칸은 고른 방식의 단위(원·%)를 뒤에 붙이고, 날짜를 넣으면 한 줄로 되읽는다.
 */
export function GoodsBulkForm({ kind, command, fields, locked, promotionIp, onCommand, onFields, onSubmit }: {
  kind: GoodsBulkKind; command: GoodsBulkCommand; fields: GoodsBulkFormFields; locked: boolean; promotionIp?: string;
  onCommand: (command: GoodsBulkCommand) => void; onFields: (patch: Partial<GoodsBulkFormFields>) => void; onSubmit: () => void;
}) {
  const choice = choiceOf(command);
  const amount = command === 'price' || command === 'discount';
  const dated = command === 'discount' || command === 'period' && fields.periodMode === 'range';
  const unit = goodsBulkModeUnit(fields.mode);
  const period = dated ? kstInputRangeLabel(fields.startsAt, fields.endsAt) : null;
  const id = (name: string) => `goods-bulk-${kind}-${name}`;
  return <form onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <fieldset className="flex min-w-0 flex-col gap-4" disabled={locked}><legend className="sr-only">일괄 변경 설정</legend>
      {choice ? <GoodChoiceCards legend="바꿀 내용">
        {choice.commands.map(([value, description]) => <GoodChoiceCard key={value} name="command" value={value} checked={command === value}
          onChange={() => onCommand(value)} title={GOODS_BULK_LABELS[value]} description={description} />)}
      </GoodChoiceCards> : null}
      {command === 'period' ? <GoodChoiceCards legend="판매기간">
        <GoodChoiceCard name="periodMode" value="range" checked={fields.periodMode === 'range'} onChange={() => onFields({ periodMode: 'range' })} title="기간 정하기" description="정한 기간에만 팝니다." />
        <GoodChoiceCard name="periodMode" value="none" checked={fields.periodMode === 'none'} onChange={() => onFields({ periodMode: 'none' })} title="기간 없이 계속 판매" description="걸려 있던 판매기간을 풉니다." />
      </GoodChoiceCards> : null}
      {amount ? <div className="grid gap-3 sm:grid-cols-2">
        <label className={FIELD}>변경 방식<AdminSelect name="mode" aria-label="변경 방식" value={fields.mode} wrapperClassName="w-full" onChange={event => onFields({ mode: event.target.value })}>
          {(command === 'price' ? PRICE_MODES : DISCOUNT_MODES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </AdminSelect></label>
        <div className={FIELD}><label htmlFor={id('value')}>{unit === '%' ? '비율' : '금액'}</label>
          <GoodAmountField unit={unit}><Input className="text-right tabular-nums" id={id('value')} name="value" inputMode="numeric" autoComplete="off"
            value={fields.value} onChange={event => onFields({ value: event.target.value })} /></GoodAmountField></div>
      </div> : null}
      {command === 'price' ? <p className={NOTE}>옵션가는 그대로 둡니다. 비율로 계산하면 1원 미만은 버립니다.</p> : null}
      {dated ? <div className="grid gap-3 sm:grid-cols-2">
        <label className={FIELD}>시작 (KST)<Input name="startsAt" type="datetime-local" value={fields.startsAt} onChange={event => onFields({ startsAt: event.target.value })} /></label>
        <label className={FIELD}>종료 (KST)<Input name="endsAt" type="datetime-local" min={fields.startsAt || undefined} value={fields.endsAt} onChange={event => onFields({ endsAt: event.target.value })} /></label>
      </div> : null}
      {period ? <GoodReadback>{period.reversed ? '종료가 시작보다 앞입니다. 날짜를 다시 확인해주세요.' : `${period.text} ${command === 'discount' ? '할인합니다.' : '팝니다.'}`}</GoodReadback> : null}
      {command === 'discount' ? <p className={NOTE}>여러 상품에 묶어서 걸고 한 번에 멈추려면 <Link className="font-medium text-primary underline-offset-4 hover:underline" href={newDiscountPromotionHref(promotionIp ? { ip: promotionIp } : {})}>할인 프로모션</Link>을 쓰세요.</p> : null}
      {command === 'discount_stop' ? <p className={NOTE}>상품마다 따로 건 할인과 할인 프로모션이 건 할인도 함께 멈춥니다. 멈춘 할인은 되살릴 수 없습니다.</p> : null}
      {command === 'restore' ? <p className={NOTE}>복원한 상품은 초안으로 돌아옵니다.</p> : null}
      {command === 'dissolve' ? <p className={NOTE}>묶였던 상품과 재고·주문 기록은 그대로 남습니다.</p> : null}
      <div className="flex flex-wrap justify-end gap-2"><Button type="submit">변경 내용 확인</Button></div>
    </fieldset>
  </form>;
}

/** 저장 전에 보는 표. 상품마다 현재 → 변경 후를 보이고, 건너뛰는 상품은 맨 위에 이유와 함께 둔다. */
export function GoodsBulkPreviewTable({ preview }: { preview: GoodsBulkPreview }) {
  const { command, values } = preview.request;
  const applied = preview.goods.filter(row => !row.skip).length, skippedCount = preview.goods.length - applied;
  const stops = command === 'discount_stop' ? preview.goods.reduce((sum, row) => sum + (row.skip ? 0 : row.discounts?.count ?? 0), 0) : 0;
  const period = command === 'discount' ? periodText(values.startsAt, values.endsAt) : null;
  return <>
    <p className="text-sm"><strong className="font-semibold">{GOODS_BULK_LABELS[command]}</strong> · 바꿀 상품 {applied}개{skippedCount ? ` · 건너뜀 ${skippedCount}개` : ''}
      {preview.groups.length ? ` · 그룹 ${preview.groups.length}개` : ''}{stops ? ` · 멈출 할인 ${stops}건` : ''}{period ? ` · ${period} (KST)` : ''}</p>
    {applied ? null : <AdminNotice role="alert" tone="warning" title="바꿀 수 있는 상품이 없습니다."><p>상품마다 건너뛴 이유를 확인해주세요.</p></AdminNotice>}
    <GroupTable label="일괄 변경 대상" layout="fixed"><TableHeader><TableRow><TableHead className="w-[44%]">상품명·상품 자동코드</TableHead><TableHead>현재</TableHead><TableHead>변경 후</TableHead></TableRow></TableHeader>
      <TableBody>{[...preview.goods].sort((a, b) => Number(Boolean(b.skip)) - Number(Boolean(a.skip))).map(row => <TableRow key={row.id} className="data-[skipped]:text-muted-foreground" data-skipped={row.skip ? 'true' : undefined}>
        <TableCell className="whitespace-normal wrap-anywhere">{row.name}{row.code ? <small className="block text-xs text-muted-foreground">{row.code}</small> : null}</TableCell>
        <TableCell className="whitespace-normal">{before(row, command)}</TableCell><TableCell className="whitespace-normal">{after(row, preview)}</TableCell></TableRow>)}</TableBody></GroupTable>
  </>;
}

/** 저장한 뒤에도 건너뛴 상품과 이유를 남긴다. */
export function GoodsBulkSkippedList({ skipped, command }: { skipped: GoodsBulkSkipped[]; command?: GoodsBulkCommand }) {
  if (!skipped.length) return null;
  return <details className="rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-sm" open><summary className="cursor-pointer font-medium">건너뛴 상품 {skipped.length}개</summary>
    <ul className="mt-2 flex max-h-60 list-disc flex-col gap-1 overflow-auto pl-5">{skipped.map(row => <li key={row.id}>{row.name}
      <small className="block text-xs text-muted-foreground">{row.code ? `${row.code} · ` : ''}{goodsBulkSkipLabel(row.reason, command)}</small></li>)}</ul></details>;
}

/* kind="ip"는 IP 필터 결과 전체(보관 제외, 최대 1,000개)에 기간 할인만 건다(A10). 조건이 안 맞는 상품은 확인 단계에서
   건너뛰기로 정해지고, 저장한 뒤 건너뛴 목록을 그대로 보여 준다. 다른 명령도 같은 방식이다(20261126120000). */
/** `selectionActions`: 같은 선택에 거는 다른 동작(선택 해제·마케팅 링크 등). 선택 개수는 이 막대에서 한 번만 보인다. */
export function GoodsBulkToolbar({ kind, selectedIds, shippingGoodIds = selectedIds, identity, disabled = false, onCompleted, ipTitle, selectionActions }: {
  kind: GoodsBulkKind; selectedIds: string[]; shippingGoodIds?: string[]; identity: GoodsGroupIdentity; disabled?: boolean; onCompleted: () => void; ipTitle?: string;
  selectionActions?: ReactNode;
}) {
  const session = useGoodsGroupSession(identity.actorId, identity.sessionId);
  const [dialog, setDialog] = useState<{ ids: string[]; command: GoodsBulkCommand } | null>(null), [preview, setPreview] = useState<GoodsBulkPreview | null>(null);
  const [message, setMessage] = useState(''), [acknowledged, setAcknowledged] = useState(false), [recovery, setRecovery] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false), [storageBroken, setStorageBroken] = useState(false), [pending, startTransition] = useTransition();
  const [skipped, setSkipped] = useState<{ rows: GoodsBulkSkipped[]; command?: GoodsBulkCommand }>({ rows: [] });
  const [fields, setFields] = useState<GoodsBulkFormFields>(() => goodsBulkInitialFields('publish'));
  const busy = useRef(false), alive = useRef(true), moreMenu = useRef<HTMLDetailsElement>(null);
  const prefix = `icons:goods-bulk:v1:${identity.actorId}:${identity.sessionId}:${kind}:`;
  function savedOperation() {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(prefix)) keys.push(key); }
    for (const key of keys.sort()) {
      const id = localStorage.getItem(key);
      if (!id || !isUuid(id) || key !== `${prefix}${id}`) throw new Error('invalid bulk journal');
      return id;
    }
    return null;
  }
  useEffect(() => {
    alive.current = true;
    const load = () => { if (!alive.current) return; try { setRecovery(savedOperation()); } catch { setStorageBroken(true); } setInitialized(true); };
    queueMicrotask(load);
    const changed = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(prefix)) load(); };
    window.addEventListener('storage', changed);
    return () => { alive.current = false; window.removeEventListener('storage', changed); };
    // The keyed list fixes identity and kind for this component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix]);
  useEffect(() => {
    if (!recovery) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [recovery]);
  /* '더보기'는 details 메뉴다 — 바깥을 누르거나 Esc를 누르면 닫는다. */
  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      const menu = moreMenu.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent) { if (event.key !== 'Escape') return; menu.querySelector('summary')?.focus(); }
      else if (event.target instanceof Node && menu.contains(event.target)) return;
      menu.open = false;
    };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss); };
  }, []);
  const locked = disabled || pending || !initialized || storageBroken || session.blocked || Boolean(recovery);
  function open(command: GoodsBulkCommand) {
    if (locked || !selectedIds.length || selectedIds.length > 100 || !session.current()) return;
    setDialog({ command, ids: [...selectedIds] }); setFields(goodsBulkInitialFields(command));
    setPreview(null); setAcknowledged(false); setMessage(''); setSkipped({ rows: [] });
  }
  function compare() {
    if (!dialog || locked || busy.current || !session.current()) return;
    const input = goodsBulkFormValues(dialog.command, fields);
    if ('error' in input) { setMessage(input.error); return; }
    const request = parseGoodsBulkRequest({ kind, ids: dialog.ids, command: dialog.command, values: input.values });
    if (!request) { setMessage('바꿀 내용의 형식이 맞지 않습니다. 창을 닫고 상품을 다시 골라주세요.'); return; }
    busy.current = true; setMessage(''); startTransition(async () => {
      try {
        const result = await previewGoodsBulkAction(crypto.randomUUID(), request, identity);
        if (!session.current()) return;
        if ('error' in result) { setMessage(result.error); if (result.authChanged) session.deny(); }
        else { setPreview(result.value); setAcknowledged(false); }
      } catch { if (session.current()) setMessage('변경 내용을 불러오지 못했습니다. 잠시 뒤 [변경 내용 확인]을 다시 눌러주세요.'); }
      finally { busy.current = false; }
    });
  }
  function accept(result: GoodsGroupResult<GoodsBulkReceipt>) {
    if (!session.current()) return;
    if ('error' in result) { setMessage(result.error); if (result.authChanged) session.deny(); return; }
    const receipt = result.value;
    if (receipt.state === 'unresolved') { setMessage(`${GOODS_BULK_UNRESOLVED} 그만두려면 [${GOODS_BULK_SEAL_LABEL}]를 눌러주세요.`); return; }
    try { localStorage.removeItem(`${prefix}${receipt.operationId}`); setRecovery(savedOperation()); }
    catch { setStorageBroken(true); setMessage('결과는 확인했지만 브라우저에 남긴 임시 기록을 지우지 못했습니다. 화면을 새로고침해주세요.'); return; }
    const skippedRows = receipt.state === 'completed' ? receipt.skipped ?? [] : [];
    setSkipped({ rows: skippedRows, command: dialog?.command }); setPreview(null); setAcknowledged(false);
    /* 거절되면 아무것도 바뀌지 않았다. 창과 적어 둔 방식·금액·기간을 그대로 두고 입력 단계로 돌아가 이유를 창 안에 보인다 —
       "다시 확인해주세요"라고 말하면서 다시 확인할 창을 닫지 않는다. 저장됐거나 그만둔 경우에만 창을 닫는다. */
    if (receipt.state === 'rejected') { setMessage(goodsBulkError(receipt.error, dialog?.command)); return; }
    setDialog(null);
    /* 창이 닫힌 뒤에 남는 한 줄이라 무엇을 바꿨는지(공개로·판매가 변경…)를 앞에 붙인다. 새로고침 뒤 [저장됐는지 확인]으로 온 결과는 명령을 모른다. */
    const done = dialog ? `${GOODS_BULK_LABELS[dialog.command]} · ` : '';
    setMessage(receipt.state === 'completed' ? `${done}상품 ${receipt.goodsCount}개${receipt.groupsCount ? ` · 그룹 ${receipt.groupsCount}개` : ''}를 바꿨습니다.${skippedRows.length ? ` 건너뛴 상품 ${skippedRows.length}개는 아래에 있습니다.` : ''}`
      : '저장하지 않고 그만뒀습니다. 지금 내용으로 처음부터 다시 해주세요.');
    if (receipt.state === 'completed') onCompleted();
  }
  function commit() {
    if (!preview || !acknowledged || locked || busy.current || !session.current()) return;
    /* CAT-008: 0원·1,000원 미만·이전 금액의 절반 이하·두 배 이상으로 바뀌는 판매가는 적용 전에 상품별 이전 → 새 값을 한 번 더 확인받는다. */
    const priceCheck = goodsBulkPriceConfirmation(preview);
    if (!priceCheck) { apply(preview); return; }
    busy.current = true;
    void adminConfirm(priceCheck).then((ok) => { busy.current = false; if (ok && session.current()) apply(preview); });
  }
  function apply(target: GoodsBulkPreview) {
    if (busy.current || !session.current()) return;
    try {
      const saved = savedOperation(); if (saved) { setRecovery(saved); setMessage(`앞서 누른 저장이 됐는지 아직 모릅니다. [${GOODS_BULK_RECOVER_LABEL}]을 먼저 눌러주세요.`); return; }
      localStorage.setItem(`${prefix}${target.operationId}`, target.operationId);
      if (localStorage.getItem(`${prefix}${target.operationId}`) !== target.operationId) throw new Error('bulk journal');
    } catch { setStorageBroken(true); setMessage('브라우저 저장공간에 쓸 수 없어 저장하지 않았습니다. 시크릿 창이 아닌지, 저장공간이 가득 차지 않았는지 확인해주세요.'); return; }
    setRecovery(target.operationId); busy.current = true; setMessage(''); startTransition(async () => {
      try { accept(await commitGoodsBulkAction(target.operationId, identity)); }
      catch { if (session.current()) setMessage(GOODS_BULK_UNCERTAIN); }
      finally { busy.current = false; }
    });
  }
  function recover(seal = false) {
    if (!recovery || pending || busy.current || !session.current()) return;
    busy.current = true; startTransition(async () => {
      try { accept(await readGoodsBulkAction(recovery, identity, seal)); }
      catch { if (session.current()) setMessage(`저장됐는지 확인하지 못했습니다. [${GOODS_BULK_RECOVER_LABEL}]을 다시 눌러주세요.`); }
      finally { busy.current = false; }
    });
  }
  /* 결과를 모를 때는 아래 알림 상자가 같은 두 문장과 버튼을 보인다 — 상태 줄에 한 번 더 적지 않는다(저장 응답이 끊겼을 때도, 서버가 모른다고 답했을 때도). */
  const statusLine = recovery && message === GOODS_BULK_UNCERTAIN ? '' : message;
  const resultStatus = <>{statusLine ? <p className="text-sm" role="status">{statusLine}</p> : null}<GoodsBulkSkippedList skipped={skipped.rows} command={skipped.command} />
    {recovery ? <AdminNotice role="alert" title="저장됐는지 확인하지 못했습니다." tone="warning"><p>[{GOODS_BULK_RECOVER_LABEL}]을 누르면 같은 내용이 두 번 저장되지 않습니다.</p><div className="mt-2 flex flex-wrap items-center gap-2">
      <Button size="sm" type="button" disabled={pending || session.blocked} onClick={() => recover()}>{GOODS_BULK_RECOVER_LABEL}</Button>
      <Button size="sm" variant="outline" type="button" disabled={pending || session.blocked} onClick={() => recover(true)}>{GOODS_BULK_SEAL_LABEL}</Button></div></AdminNotice> : null}</>;
  const appliedCount = preview ? preview.goods.filter(row => !row.skip).length : 0;
  const unavailable = locked || !selectedIds.length || selectedIds.length > 100;
  /* 자주 쓰는 네 가지는 바로 누르고, 나머지는 '더보기'에 둔다 — 줄이 짧아져 선택 동작(마케팅 링크 등)을 찾기 쉽다. */
  const commonCommands: [GoodsBulkCommand, string][] = [['publish', goodsBulkDialogTitle('publish')], ['start', goodsBulkDialogTitle('start')], ['price', goodsBulkDialogTitle('price')], ['discount', goodsBulkDialogTitle('discount')]];
  const moreCommands: [GoodsBulkCommand, string][] = [['period', GOODS_BULK_LABELS.period], ['archive', GOODS_BULK_LABELS.archive], ['restore', GOODS_BULK_LABELS.restore], ...(kind === 'groups' ? [['dissolve', GOODS_BULK_LABELS.dissolve] as [GoodsBulkCommand, string]] : [])];
  function chooseMore(command: GoodsBulkCommand) {
    /* 팝업이 닫힐 때 포커스가 돌아올 자리를 메뉴 버튼으로 둔 뒤 메뉴를 닫는다(항목은 접히면 사라진다). */
    const menu = moreMenu.current; menu?.querySelector('summary')?.focus(); if (menu) menu.open = false;
    open(command);
  }
  return <div className="flex min-w-0 flex-col gap-2" data-goods-bulk={kind}>
    {kind === 'ip' ? <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2"><strong className="mr-1 text-sm font-semibold whitespace-nowrap">IP 전체 · {ipTitle ?? '이름 없는 IP'}</strong>
      <Button size="sm" variant="outline" type="button" disabled={locked || selectedIds.length !== 1} onClick={() => open('discount')}>IP 전체 기간 할인</Button>
      {selectedIds.length === 1 ? <Link className={buttonVariants({ size: 'sm', variant: 'ghost' })} data-slot="button" href={newDiscountPromotionHref({ ip: selectedIds[0] })}>IP 할인 프로모션 만들기</Link> : null}
      <small className="text-xs text-muted-foreground">이 IP의 보관하지 않은 상품 전체(최대 {GOODS_BULK_IP_LIMIT.toLocaleString('ko-KR')}개)에 겁니다.</small>
    </div> : <div className="flex flex-wrap items-center gap-1.5"><strong className="mr-1 text-sm font-semibold whitespace-nowrap tabular-nums">{selectedIds.length}개 선택</strong>
      {commonCommands.map(([command, label]) =>
        <Button key={command} size="sm" variant="outline" type="button" disabled={unavailable} onClick={() => open(command)}>{label}</Button>)}
      {unavailable ? <Button size="sm" variant="outline" type="button" disabled>더보기<ChevronDown aria-hidden="true" /></Button> : <details className="group/more relative" data-goods-bulk-more="" ref={moreMenu}>
        <summary className={`${buttonVariants({ size: 'sm', variant: 'outline' })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} data-slot="button">더보기<ChevronDown aria-hidden="true" className="transition-transform group-open/more:rotate-180" /></summary>
        <div className="z-20 mt-1 flex w-36 flex-col gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md sm:absolute sm:top-full sm:left-0">
          {moreCommands.map(([command, label]) => <button className={MENU_ITEM} data-slot="button" key={command} type="button" onClick={() => chooseMore(command)}>{label}</button>)}
          {shippingGoodIds.length > 0 && shippingGoodIds.length <= 100 ? <Link className={MENU_ITEM} data-slot="button" href={goodsBulkShippingHref(shippingGoodIds)}>배송 변경</Link> : <button className={MENU_ITEM} data-slot="button" type="button" disabled>배송 변경</button>}
        </div>
      </details>}
      {selectionActions ? <><span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />{selectionActions}</> : null}
    </div>}
    {session.blocked ? <p className="text-sm text-destructive" role="alert">로그인한 계정이 바뀌었거나 다시 로그인했습니다. 화면을 새로고침해주세요.</p> : null}
    {storageBroken ? <p className="text-sm text-destructive" role="alert">브라우저 저장공간을 읽지 못해 일괄 변경을 잠갔습니다. 브라우저에서 이 사이트의 데이터 저장을 허용한 뒤 새로고침해주세요.</p> : null}
    {!dialog ? resultStatus : null}
    {dialog ? <CustomerServiceDialog title={preview ? '일괄 변경 내용 확인' : goodsBulkDialogTitle(dialog.command)} busy={pending || Boolean(recovery)} onClose={() => { if (!pending && !recovery) setDialog(null); }}>
      <div className="flex min-w-0 flex-col gap-4"><p className={NOTE}>{targetLine(kind, dialog.ids.length, ipTitle)}</p>
        {!preview ? <GoodsBulkForm kind={kind} command={dialog.command} fields={fields} locked={locked} promotionIp={kind === 'ip' ? dialog.ids[0] : undefined}
          onCommand={command => { setDialog({ ...dialog, command }); setMessage(''); }} onFields={patch => { setFields(current => ({ ...current, ...patch })); setMessage(''); }} onSubmit={compare} /> : <>
          <GoodsBulkPreviewTable preview={preview} />
          {appliedCount ? <><p className={NOTE}>15분 안에 저장해주세요.</p>
            <label className={CHECK}><input type="checkbox" checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} />바꿀 상품과 내용을 확인했습니다.</label></> : null}
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" type="button" disabled={locked} onClick={() => { setPreview(null); setAcknowledged(false); }}>다시 입력</Button>
            <Button type="button" disabled={locked || !acknowledged || !appliedCount} onClick={commit}>변경사항 저장</Button></div>
        </>}
        {resultStatus}
      </div>
    </CustomerServiceDialog> : null}
  </div>;
}
