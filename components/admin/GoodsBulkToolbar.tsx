'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { previewGoodsBulkAction, commitGoodsBulkAction, readGoodsBulkAction } from '@/app/admin/goods-bulk-actions';
import { GOODS_BULK_IP_LIMIT, GOODS_BULK_LABELS, goodsBulkError, goodsBulkShippingHref, goodsBulkSkipLabel, parseGoodsBulkRequest, type GoodsBulkCommand, type GoodsBulkKind, type GoodsBulkPreview, type GoodsBulkReceipt, type GoodsBulkSkipped } from '@/lib/admin/goods-bulk';
import { isUuid } from '@/lib/uuid';
import { parseGoodsPricePeriodInput } from '@/lib/admin/goods-price-periods';
import { newDiscountPromotionHref } from '@/lib/admin/discount-promotions';
import type { GoodsGroupIdentity, GoodsGroupResult } from '@/lib/admin/goods-groups';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { GroupTable, useGoodsGroupSession } from './GoodsGroupOperation';
import { AdminNotice } from './console/AdminKit';
import { AdminSelect } from './console/AdminSelect';
import { Button, buttonVariants } from './kit/ui/button';
import { Input } from './kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './kit/ui/table';

const money = (value: number | null) => value === null ? '사용 옵션 없음' : `${value.toLocaleString('ko-KR')}원`;
const range = (min: number | null, max: number | null) => min === max ? money(min) : `${money(min)} ~ ${money(max)}`;
function status(row: GoodsBulkPreview['goods'][number]) { return row.archived ? '보관' : row.published ? '공개' : '초안'; }
const kstDate = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
/* 할인 중지로 꺼질 진행·예정 할인을 상품별로 보여 준다(개별로 걸어 둔 할인 포함). */
function activeDiscountLabel(row: GoodsBulkPreview['goods'][number]) {
  const value = row.discounts;
  if (!value) return '진행·예정 할인 없음';
  return `할인 ${value.count}건 · ${range(value.minPrice, value.maxPrice)} · ${kstDate(value.startsAt)} ~ ${kstDate(value.endsAt)}`;
}
function after(row: GoodsBulkPreview['goods'][number], command: GoodsBulkCommand) {
  if (row.skip) return `건너뜀 · ${goodsBulkSkipLabel(row.skip)}`;
  if (command === 'publish') return '공개'; if (command === 'unpublish') return '초안';
  if (command === 'start') return '판매 운영'; if (command === 'stop') return '판매 중지';
  if (command === 'archive') return '보관'; if (command === 'restore') return '복원';
  if (command === 'price' || command === 'discount') return range(row.nextMin, row.nextMax);
  return GOODS_BULK_LABELS[command];
}
const FIELD = 'flex min-w-0 flex-col gap-2 text-sm font-medium';
const NOTE = 'text-sm text-muted-foreground';
const CHECK = 'flex cursor-pointer items-center gap-2 text-sm';
const MENU_ITEM = 'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50';
/* kind="ip"는 IP 필터 결과 전체(보관 제외, 최대 1,000개)에 즉시할인만 적용한다(A10). 기간이 겹치는
   상품은 비교 단계에서 건너뛰기로 고정되고, 저장 후 건너뛴 목록을 그대로 보여 준다. */
/** `selectionActions`: 같은 선택에 거는 다른 동작(선택 해제·마케팅 링크 등). 선택 개수는 이 막대에서 한 번만 보인다. */
export function GoodsBulkToolbar({ kind, selectedIds, shippingGoodIds = selectedIds, identity, disabled = false, onCompleted, ipTitle, selectionActions }: {
  kind: GoodsBulkKind; selectedIds: string[]; shippingGoodIds?: string[]; identity: GoodsGroupIdentity; disabled?: boolean; onCompleted: () => void; ipTitle?: string;
  selectionActions?: ReactNode;
}) {
  const session = useGoodsGroupSession(identity.actorId, identity.sessionId);
  const [dialog, setDialog] = useState<{ ids: string[]; command: GoodsBulkCommand } | null>(null), [preview, setPreview] = useState<GoodsBulkPreview | null>(null);
  const [message, setMessage] = useState(''), [acknowledged, setAcknowledged] = useState(false), [recovery, setRecovery] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false), [storageBroken, setStorageBroken] = useState(false), [pending, startTransition] = useTransition();
  const [skipped, setSkipped] = useState<GoodsBulkSkipped[]>([]);
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
    setDialog({ command, ids: [...selectedIds] }); setPreview(null); setAcknowledged(false); setMessage(''); setSkipped([]);
  }
  function compare(form: FormData) {
    if (!dialog || locked || busy.current || !session.current()) return;
    const command = String(form.get('command') ?? dialog.command) as GoodsBulkCommand;
    const values: Record<string, string | number | null> = {};
    if (command === 'price' || command === 'discount') { values.mode = String(form.get('mode')); values.value = Number(form.get('value')); }
    if (command === 'period' || command === 'discount') {
      const unlimited = command === 'period' && form.get('unlimited') === 'true';
      const parsed = parseGoodsPricePeriodInput({ state: 'draft', discountPrice: null, startsAt: unlimited ? null : form.get('startsAt'), endsAt: unlimited ? null : form.get('endsAt') });
      if (!parsed || !unlimited && (!parsed.startsAt || !parsed.endsAt)) { setMessage('KST 기준 시작·종료를 입력해주세요. 종료는 시작보다 늦어야 합니다.'); return; }
      values.startsAt = parsed.startsAt; values.endsAt = parsed.endsAt;
    }
    const request = parseGoodsBulkRequest({ kind, ids: dialog.ids, command, values });
    if (!request) { setMessage('변경할 금액·비율·기간을 확인해주세요.'); return; }
    busy.current = true; setMessage(''); startTransition(async () => {
      try {
        const result = await previewGoodsBulkAction(crypto.randomUUID(), request, identity);
        if (!session.current()) return;
        if ('error' in result) { setMessage(result.error); if (result.authChanged) session.deny(); }
        else { setPreview(result.value); setAcknowledged(false); }
      } catch { if (session.current()) setMessage('변경 내용을 불러오지 못했습니다. 다시 확인해주세요.'); }
      finally { busy.current = false; }
    });
  }
  function accept(result: GoodsGroupResult<GoodsBulkReceipt>) {
    if (!session.current()) return;
    if ('error' in result) { setMessage(result.error); if (result.authChanged) session.deny(); return; }
    const receipt = result.value;
    if (receipt.state === 'unresolved') { setMessage('완료 기록이 없습니다. 다시 조회하거나 미처리 요청을 종료해주세요.'); return; }
    try { localStorage.removeItem(`${prefix}${receipt.operationId}`); setRecovery(savedOperation()); }
    catch { setStorageBroken(true); setMessage('결과는 확인했지만 진행 기록을 정리하지 못했습니다. 화면을 다시 열어주세요.'); return; }
    setPreview(null); setDialog(null); setSkipped(receipt.state === 'completed' ? receipt.skipped ?? [] : []);
    setMessage(receipt.state === 'completed' ? `${receipt.goodsCount}개 상품${receipt.groupsCount ? ` · ${receipt.groupsCount}개 그룹` : ''}의 변경을 확인했습니다.${receipt.skipped?.length ? ` 건너뛴 상품 ${receipt.skipped.length}개는 아래에서 확인해주세요.` : ''}`
      : receipt.state === 'sealed' ? '미처리 요청을 종료했습니다. 최신 내용으로 다시 준비해주세요.' : goodsBulkError(receipt.error));
    if (receipt.state === 'completed') onCompleted();
  }
  function commit() {
    if (!preview || !acknowledged || locked || busy.current || !session.current()) return;
    try {
      const saved = savedOperation(); if (saved) { setRecovery(saved); setMessage('먼저 이전 요청의 결과를 확인해주세요.'); return; }
      localStorage.setItem(`${prefix}${preview.operationId}`, preview.operationId);
      if (localStorage.getItem(`${prefix}${preview.operationId}`) !== preview.operationId) throw new Error('bulk journal');
    } catch { setStorageBroken(true); setMessage('진행 내역을 보관하지 못해 실행하지 않았습니다. 브라우저 저장공간을 확인해주세요.'); return; }
    setRecovery(preview.operationId); busy.current = true; setMessage(''); startTransition(async () => {
      try { accept(await commitGoodsBulkAction(preview.operationId, identity)); }
      catch { if (session.current()) setMessage('결과가 불명확합니다. 같은 요청의 결과를 조회해주세요.'); }
      finally { busy.current = false; }
    });
  }
  function recover(seal = false) {
    if (!recovery || pending || busy.current || !session.current()) return;
    busy.current = true; startTransition(async () => {
      try { accept(await readGoodsBulkAction(recovery, identity, seal)); }
      catch { if (session.current()) setMessage('처리 결과를 불러오지 못했습니다. 다시 조회해주세요.'); }
      finally { busy.current = false; }
    });
  }
  const resultStatus = <>{message ? <p className="text-sm" role="status">{message}</p> : null}{skipped.length ? <details className="rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-sm" open><summary className="cursor-pointer font-medium">건너뛴 상품 {skipped.length}개</summary>
    <ul className="mt-2 flex max-h-60 list-disc flex-col gap-1 overflow-auto pl-5">{skipped.map(row => <li key={row.id}>{row.name}<small className="block text-xs text-muted-foreground">{row.code ?? row.id} · {goodsBulkSkipLabel(row.reason)}</small></li>)}</ul></details> : null}{recovery ? <AdminNotice role="alert" title="처리 결과 확인이 남아 있습니다." tone="warning"><p>재실행하지 않고 저장된 결과를 확인합니다.</p><div className="mt-2 flex flex-wrap items-center gap-2">
    <Button size="sm" type="button" disabled={pending || session.blocked} onClick={() => recover()}>처리 결과 조회</Button>
    <Button size="sm" variant="outline" type="button" disabled={pending || session.blocked} onClick={() => recover(true)}>미처리 요청 종료</Button></div></AdminNotice> : null}</>;
  const appliedCount = preview ? preview.goods.filter(row => !row.skip).length : 0;
  const unavailable = locked || !selectedIds.length || selectedIds.length > 100;
  /* 자주 쓰는 네 가지는 바로 누르고, 나머지는 '더보기'에 둔다 — 줄이 짧아져 선택 동작(마케팅 링크 등)을 찾기 쉽다. */
  const commonCommands: [GoodsBulkCommand, string][] = [['publish', '전시 변경'], ['start', '판매 변경'], ['price', '판매가 변경'], ['discount', '즉시할인']];
  const moreCommands: [GoodsBulkCommand, string][] = [['period', '판매기간 변경'], ['archive', '선택 보관'], ['restore', '선택 복원'], ...(kind === 'groups' ? [['dissolve', '그룹 해제'] as [GoodsBulkCommand, string]] : [])];
  function chooseMore(command: GoodsBulkCommand) {
    /* 팝업이 닫힐 때 포커스가 돌아올 자리를 메뉴 버튼으로 둔 뒤 메뉴를 닫는다(항목은 접히면 사라진다). */
    const menu = moreMenu.current; menu?.querySelector('summary')?.focus(); if (menu) menu.open = false;
    open(command);
  }
  return <div className="flex min-w-0 flex-col gap-2" data-goods-bulk={kind}>
    {kind === 'ip' ? <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2"><strong className="mr-1 text-sm font-semibold whitespace-nowrap">IP 전체 · {ipTitle ?? selectedIds[0]}</strong>
      <Button size="sm" variant="outline" type="button" disabled={locked || selectedIds.length !== 1} onClick={() => open('discount')}>IP 전체 즉시할인</Button>
      {selectedIds.length === 1 ? <Link className={buttonVariants({ size: 'sm', variant: 'ghost' })} data-slot="button" href={newDiscountPromotionHref({ ip: selectedIds[0] })}>IP 할인 프로모션 만들기</Link> : null}
      <small className="text-xs text-muted-foreground">선택과 관계없이 이 IP의 보관하지 않은 전체 상품(최대 {GOODS_BULK_IP_LIMIT.toLocaleString('ko-KR')}개)에 적용합니다. 묶음으로 조회·중지하려면 할인 프로모션으로 만드세요.</small>
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
    {session.blocked ? <p className="text-sm text-destructive" role="alert">로그인 계정 또는 세션이 변경되었습니다. 화면을 다시 열어주세요.</p> : null}
    {storageBroken ? <p className="text-sm text-destructive" role="alert">진행 기록을 확인하지 못했습니다. 브라우저 저장공간을 확인하고 화면을 다시 열어주세요.</p> : null}
    {!dialog ? resultStatus : null}
    {dialog ? <CustomerServiceDialog title={preview ? '일괄 변경 내용 확인' : GOODS_BULK_LABELS[dialog.command]} busy={pending || Boolean(recovery)} onClose={() => { if (!pending && !recovery) setDialog(null); }}>
      <div className="flex min-w-0 flex-col gap-4">{kind === 'ip' ? <p className={NOTE}>{ipTitle ?? dialog.ids[0]} IP의 보관하지 않은 전체 상품을 변경합니다. 한 번에 최대 {GOODS_BULK_IP_LIMIT.toLocaleString('ko-KR')}개이며, 대상 목록은 비교 시점에 고정합니다.</p>
        : <p className={NOTE}>선택한 {kind === 'groups' ? '그룹' : '상품'} {dialog.ids.length}개{kind === 'groups' ? '에 속한 개별 상품을 변경합니다.' : '를 변경합니다.'} 개별 상품은 한 번에 최대 100개입니다.</p>}
        {!preview ? <form onSubmit={event => { event.preventDefault(); compare(new FormData(event.currentTarget)); }}>
          <fieldset className="flex min-w-0 flex-col gap-4" disabled={locked}><legend className="sr-only">일괄 변경 설정</legend>
            {['publish', 'unpublish', 'start', 'stop', 'discount', 'discount_stop'].includes(dialog.command) ? <label className={FIELD}>변경 내용<AdminSelect name="command" aria-label="변경 내용" value={dialog.command} wrapperClassName="w-full" onChange={event => setDialog({ ...dialog, command: event.target.value as GoodsBulkCommand })}>
              {(['publish', 'unpublish'].includes(dialog.command) ? ['publish', 'unpublish'] : ['start', 'stop'].includes(dialog.command) ? ['start', 'stop'] : ['discount', 'discount_stop']).map(command => <option key={command} value={command}>{GOODS_BULK_LABELS[command as GoodsBulkCommand]}</option>)}
            </AdminSelect></label> : <input type="hidden" name="command" value={dialog.command} />}
            {dialog.command === 'price' || dialog.command === 'discount' ? <div className="grid gap-3 sm:grid-cols-2"><label className={FIELD}>변경 방식<AdminSelect name="mode" aria-label="변경 방식" defaultValue={dialog.command === 'price' ? 'set' : 'amount'} wrapperClassName="w-full">
              {(dialog.command === 'price' ? [['set', '기본 판매가 지정 (원)'], ['increase', '기본 판매가 인상 (원)'], ['decrease', '기본 판매가 인하 (원)'], ['percent_increase', '기본 판매가 인상 (%)'], ['percent_decrease', '기본 판매가 인하 (%)']] : [['amount', '옵션별 정액 할인 (원)'], ['rate', '옵션별 정률 할인 (%)']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </AdminSelect></label><label className={FIELD}>금액 또는 비율<Input className="text-right tabular-nums" name="value" type="number" min={1} max={2147483647} step={1} required /></label></div> : null}
            {dialog.command === 'price' ? <p className={NOTE}>기본 판매가를 변경하며 옵션 추가금액과 재고수량은 유지합니다. 비율 계산 시 원 미만은 버립니다.</p> : null}
            {dialog.command === 'period' ? <label className={CHECK}><input type="checkbox" name="unlimited" value="true" />판매기간 제한 해제</label> : null}
            {dialog.command === 'period' || dialog.command === 'discount' ? <div className="grid gap-3 sm:grid-cols-2"><label className={FIELD}>시작 (KST)<Input name="startsAt" type="datetime-local" /></label><label className={FIELD}>종료 (KST)<Input name="endsAt" type="datetime-local" /></label></div> : null}
            {dialog.command === 'discount' ? <p className={NOTE}>사용 중인 모든 옵션에 기간 할인을 등록합니다. 기존 활성 할인과 시간이 겹치거나 할인가가 맞지 않는 상품은 건너뛰고, 비교 결과와 저장 후에 그 목록을 보여 드립니다. 기획전·IP 단위로 묶어 걸고 한두 상품만 다른 할인율로 정하거나 묶음으로 중지하려면 <Link className="font-medium text-primary underline-offset-4 hover:underline" href={newDiscountPromotionHref(kind === 'ip' ? { ip: dialog.ids[0] } : {})}>할인 프로모션</Link>을 쓰세요.</p> : null}
            {dialog.command === 'discount_stop' ? <p className={NOTE}>{kind === 'ip' ? '이 IP의 보관하지 않은 전체 상품에서 진행 중이거나 예정된 기간 할인을 모두 중지합니다. IP 전체 할인뿐 아니라 상품별로 따로 걸어 둔 할인과 할인 프로모션이 건 할인도 함께 중지되니, 변경 내용 확인에서 꺼질 할인을 상품별로 확인해주세요.'
              : '선택 상품의 진행 중이거나 예정된 기간 할인(할인 프로모션이 건 할인 포함)을 모두 중지합니다. 변경 내용 확인에서 꺼질 할인을 상품별로 확인해주세요.'} 진행 중이거나 예정된 할인이 없는 상품은 건너뜁니다. 이미 끝난 기간의 할인은 이력으로 남고(중지로 바뀌지 않음) 기존 주문 금액도 바뀌지 않습니다. 한 프로모션의 할인만 끄려면 할인 프로모션 상세에서 중지하세요.</p> : null}
            {dialog.command === 'archive' ? <p className={NOTE}>재고·진행 중 거래 등 보관 조건을 확인합니다. 보관된 상품은 목록에서 복원할 수 있습니다.</p> : null}
            {dialog.command === 'restore' ? <p className={NOTE}>보관을 해제합니다. 공개 전 필요한 상품정보와 KC 검토를 확인해주세요.</p> : null}
            {dialog.command === 'dissolve' ? <p className={NOTE}>그룹 연결을 해제합니다. 개별 상품·재고·주문 이력과 원상품의 합산 조건은 유지합니다.</p> : null}
            <div className="flex flex-wrap justify-end gap-2"><Button type="submit">변경 내용 확인</Button></div>
          </fieldset>
        </form> : <>
          <p className="text-sm"><strong className="font-semibold">{GOODS_BULK_LABELS[preview.request.command]}</strong> · 상품 {preview.goods.length}개{preview.groups.length ? ` · 그룹 ${preview.groups.length}개` : ''}
            {['discount', 'discount_stop'].includes(preview.request.command) ? ` · 적용 ${appliedCount}개 · 건너뜀 ${preview.goods.length - appliedCount}개` : ''}
            {preview.request.command === 'discount_stop' ? ` · 꺼질 할인 ${preview.goods.reduce((sum, row) => sum + (row.skip ? 0 : row.discounts?.count ?? 0), 0)}건` : ''}</p>
          {preview.request.values.startsAt ? <p className="text-sm">{new Date(String(preview.request.values.startsAt)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} ~ {new Date(String(preview.request.values.endsAt)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (KST)</p> : preview.request.command === 'period' ? <p className="text-sm">판매기간 제한을 해제합니다.</p> : null}
          <GroupTable label="일괄 변경 대상" layout="fixed"><TableHeader><TableRow><TableHead className="w-[44%]">상품명·판매자상품코드</TableHead><TableHead>현재</TableHead><TableHead>변경 후</TableHead></TableRow></TableHeader><TableBody>{[...preview.goods].sort((a, b) => Number(Boolean(b.skip)) - Number(Boolean(a.skip))).map(row => <TableRow key={row.id} className="data-[skipped]:text-muted-foreground" data-skipped={row.skip ? 'true' : undefined}><TableCell className="whitespace-normal wrap-anywhere">{row.name}<small className="block text-xs text-muted-foreground">{row.code ?? row.id}</small></TableCell>
            <TableCell className="whitespace-normal">{preview.request.command === 'discount_stop' ? activeDiscountLabel(row) : ['price', 'discount'].includes(preview.request.command) ? range(row.priceMin, row.priceMax) : ['start', 'stop'].includes(preview.request.command) ? row.stopped ? '판매 중지' : '판매 운영' : status(row)}</TableCell><TableCell className="whitespace-normal">{after(row, preview.request.command)}</TableCell></TableRow>)}</TableBody></GroupTable>
          <p className={NOTE}>{['discount', 'discount_stop'].includes(preview.request.command) ? '비교 이후 상품·옵션 가격이나 할인 기간이 바뀌면 전체 적용을 중단합니다(판매로 인한 재고 변동은 영향 없음).' : '비교 이후 상품이나 재고가 바뀌면 전체 적용을 중단합니다.'} 비교 결과는 15분 동안 유효합니다.</p>
          <label className={CHECK}><input type="checkbox" checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} />대상과 변경 내용을 확인했습니다.</label>
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" type="button" disabled={locked} onClick={() => { setPreview(null); setAcknowledged(false); }}>다시 입력</Button>
            <Button type="button" disabled={locked || !acknowledged} onClick={commit}>변경사항 저장</Button></div>
        </>}
        {resultStatus}
      </div>
    </CustomerServiceDialog> : null}
  </div>;
}
