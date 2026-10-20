'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { previewGoodsBulkAction, commitGoodsBulkAction, readGoodsBulkAction } from '@/app/admin/goods-bulk-actions';
import { GOODS_BULK_LABELS, goodsBulkError, goodsBulkShippingHref, parseGoodsBulkRequest, type GoodsBulkCommand, type GoodsBulkKind, type GoodsBulkPreview, type GoodsBulkReceipt } from '@/lib/admin/goods-bulk';
import { isUuid } from '@/lib/uuid';
import { parseGoodsPricePeriodInput } from '@/lib/admin/goods-price-periods';
import type { GoodsGroupIdentity, GoodsGroupResult } from '@/lib/admin/goods-groups';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { GROUP_BUTTON, GROUP_PRIMARY, GroupTable, useGoodsGroupSession } from './GoodsGroupOperation';

const money = (value: number | null) => value === null ? '사용 옵션 없음' : `${value.toLocaleString('ko-KR')}원`;
const range = (min: number | null, max: number | null) => min === max ? money(min) : `${money(min)} ~ ${money(max)}`;
function status(row: GoodsBulkPreview['goods'][number]) { return row.archived ? '보관' : row.published ? '전시중' : '미전시'; }
function after(row: GoodsBulkPreview['goods'][number], command: GoodsBulkCommand) {
  if (command === 'publish') return '전시중'; if (command === 'unpublish') return '미전시';
  if (command === 'start') return '판매 운영'; if (command === 'stop') return '판매 중지';
  if (command === 'archive') return '보관'; if (command === 'restore') return '복원';
  if (command === 'price' || command === 'discount') return range(row.nextMin, row.nextMax);
  return GOODS_BULK_LABELS[command];
}
export function GoodsBulkToolbar({ kind, selectedIds, shippingGoodIds = selectedIds, identity, disabled = false, onCompleted }: {
  kind: GoodsBulkKind; selectedIds: string[]; shippingGoodIds?: string[]; identity: GoodsGroupIdentity; disabled?: boolean; onCompleted: () => void;
}) {
  const session = useGoodsGroupSession(identity.actorId, identity.sessionId);
  const [dialog, setDialog] = useState<{ ids: string[]; command: GoodsBulkCommand } | null>(null), [preview, setPreview] = useState<GoodsBulkPreview | null>(null);
  const [message, setMessage] = useState(''), [acknowledged, setAcknowledged] = useState(false), [recovery, setRecovery] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false), [storageBroken, setStorageBroken] = useState(false), [pending, startTransition] = useTransition();
  const busy = useRef(false), alive = useRef(true);
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
  const locked = disabled || pending || !initialized || storageBroken || session.blocked || Boolean(recovery);
  function open(command: GoodsBulkCommand) {
    if (locked || !selectedIds.length || selectedIds.length > 100 || !session.current()) return;
    setDialog({ command, ids: [...selectedIds] }); setPreview(null); setAcknowledged(false); setMessage('');
  }
  function compare(form: FormData) {
    if (!dialog || locked || busy.current || !session.current()) return;
    const command = String(form.get('command') ?? dialog.command) as GoodsBulkCommand;
    const values: Record<string, string | number | null> = {};
    if (command === 'price' || command === 'discount') { values.mode = String(form.get('mode')); values.value = Number(form.get('value')); }
    if (command === 'period' || command === 'discount') {
      const unlimited = command === 'period' && form.get('unlimited') === 'true';
      const parsed = parseGoodsPricePeriodInput({ state: 'draft', discountPrice: null, startsAt: unlimited ? null : form.get('startsAt'), endsAt: unlimited ? null : form.get('endsAt') });
      if (!parsed || !unlimited && (!parsed.startsAt || !parsed.endsAt)) { setMessage('한국 시간 기준 시작·종료를 입력해주세요. 종료는 시작보다 늦어야 합니다.'); return; }
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
    setPreview(null); setDialog(null);
    setMessage(receipt.state === 'completed' ? `${receipt.goodsCount}개 상품${receipt.groupsCount ? ` · ${receipt.groupsCount}개 그룹` : ''}의 변경을 확인했습니다.`
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
  const resultStatus = <>{message ? <p role="status">{message}</p> : null}{recovery ? <div className="admin-goods-bulk__recovery" role="alert"><p>처리 결과 확인이 남아 있습니다. 재실행하지 않고 저장된 결과를 확인합니다.</p>
    <button className={GROUP_PRIMARY} type="button" disabled={pending || session.blocked} onClick={() => recover()}>처리 결과 조회</button>
    <button className={GROUP_BUTTON} type="button" disabled={pending || session.blocked} onClick={() => recover(true)}>미처리 요청 종료</button></div> : null}</>;
  return <div className="admin-goods-bulk">
    <div className="admin-goods-bulk__toolbar"><strong>{selectedIds.length}개 선택</strong>
      {([['publish', '전시 변경'], ['start', '판매 변경'], ['price', '판매가 변경'], ['discount', '즉시할인'], ['period', '판매기간 변경'], ['archive', '선택 보관'], ['restore', '선택 복원'], ...(kind === 'groups' ? [['dissolve', '그룹 해제']] : [])] as [GoodsBulkCommand, string][]).map(([command, label]) =>
        <button key={command} className={GROUP_BUTTON} type="button" disabled={locked || !selectedIds.length || selectedIds.length > 100} onClick={() => open(command)}>{label}</button>)}
      {shippingGoodIds.length > 0 && shippingGoodIds.length <= 100 && !locked ? <Link className={GROUP_BUTTON} href={goodsBulkShippingHref(shippingGoodIds)}>배송 변경</Link>
        : <button className={GROUP_BUTTON} type="button" disabled>배송 변경</button>}
    </div>
    {session.blocked ? <p role="alert">로그인 계정 또는 세션이 변경되었습니다. 화면을 다시 열어주세요.</p> : null}
    {storageBroken ? <p role="alert">진행 기록을 확인하지 못했습니다. 브라우저 저장공간을 확인하고 화면을 다시 열어주세요.</p> : null}
    {!dialog ? resultStatus : null}
    {dialog ? <CustomerServiceDialog title={preview ? '일괄 변경 내용 확인' : GOODS_BULK_LABELS[dialog.command]} busy={pending || Boolean(recovery)} onClose={() => { if (!pending && !recovery) setDialog(null); }}>
      <div className="admin-goods-bulk__dialog"><p>선택한 {kind === 'groups' ? '그룹' : '상품'} {dialog.ids.length}개{kind === 'groups' ? '에 속한 개별 상품을 변경합니다.' : '를 변경합니다.'} 개별 상품은 한 번에 최대 100개입니다.</p>
        {!preview ? <form onSubmit={event => { event.preventDefault(); compare(new FormData(event.currentTarget)); }}>
          <fieldset disabled={locked}><legend className="sr-only">일괄 변경 설정</legend>
            {['publish', 'unpublish', 'start', 'stop', 'discount', 'discount_stop'].includes(dialog.command) ? <label>변경 내용<select name="command" aria-label="변경 내용" value={dialog.command} onChange={event => setDialog({ ...dialog, command: event.target.value as GoodsBulkCommand })}>
              {(['publish', 'unpublish'].includes(dialog.command) ? ['publish', 'unpublish'] : ['start', 'stop'].includes(dialog.command) ? ['start', 'stop'] : ['discount', 'discount_stop']).map(command => <option key={command} value={command}>{GOODS_BULK_LABELS[command as GoodsBulkCommand]}</option>)}
            </select></label> : <input type="hidden" name="command" value={dialog.command} />}
            {dialog.command === 'price' || dialog.command === 'discount' ? <div className="admin-goods-bulk__fields"><label>변경 방식<select name="mode" aria-label="변경 방식" defaultValue={dialog.command === 'price' ? 'set' : 'amount'}>
              {(dialog.command === 'price' ? [['set', '기본 판매가 지정 (원)'], ['increase', '기본 판매가 인상 (원)'], ['decrease', '기본 판매가 인하 (원)'], ['percent_increase', '기본 판매가 인상 (%)'], ['percent_decrease', '기본 판매가 인하 (%)']] : [['amount', '옵션별 정액 할인 (원)'], ['rate', '옵션별 정률 할인 (%)']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label><label>금액 또는 비율<input name="value" type="number" min={1} max={2147483647} step={1} required /></label></div> : null}
            {dialog.command === 'price' ? <p>기본 판매가를 변경하며 옵션 추가금액과 재고수량은 유지합니다. 비율 계산 시 원 미만은 버립니다.</p> : null}
            {dialog.command === 'period' ? <label className="admin-goods-bulk__check"><input type="checkbox" name="unlimited" value="true" />판매기간 제한 해제</label> : null}
            {dialog.command === 'period' || dialog.command === 'discount' ? <div className="admin-goods-bulk__fields"><label>시작 (한국 시간)<input name="startsAt" type="datetime-local" /></label><label>종료 (한국 시간)<input name="endsAt" type="datetime-local" /></label></div> : null}
            {dialog.command === 'discount' ? <p>사용 중인 모든 옵션에 기간 할인을 등록합니다. 기존 활성 할인과 시간이 겹치면 전체 변경을 취소합니다.</p> : null}
            {dialog.command === 'discount_stop' ? <p>선택 상품의 활성 기간 할인을 모두 중지합니다. 기존 주문 금액과 할인 이력은 유지합니다.</p> : null}
            {dialog.command === 'archive' ? <p>재고·진행 중 거래 등 보관 조건을 확인합니다. 보관된 상품은 목록에서 복원할 수 있습니다.</p> : null}
            {dialog.command === 'restore' ? <p>보관을 해제합니다. 공개 전 필요한 상품정보와 KC 검토를 확인해주세요.</p> : null}
            {dialog.command === 'dissolve' ? <p>그룹 연결을 해제합니다. 개별 상품·재고·주문 이력과 원상품의 합산 조건은 유지합니다.</p> : null}
            <div className="admin-goods-bulk__actions"><button className={GROUP_PRIMARY} type="submit">변경 내용 확인</button></div>
          </fieldset>
        </form> : <>
          <p><strong>{GOODS_BULK_LABELS[preview.request.command]}</strong> · 상품 {preview.goods.length}개{preview.groups.length ? ` · 그룹 ${preview.groups.length}개` : ''}</p>
          {preview.request.values.startsAt ? <p>{new Date(String(preview.request.values.startsAt)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} ~ {new Date(String(preview.request.values.endsAt)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국 시간)</p> : preview.request.command === 'period' ? <p>판매기간 제한을 해제합니다.</p> : null}
          <GroupTable label="일괄 변경 대상"><thead><tr><th>상품명·판매자상품코드</th><th>현재</th><th>변경 후</th></tr></thead><tbody>{preview.goods.map(row => <tr key={row.id}><td>{row.name}<small>{row.code ?? row.id}</small></td>
            <td>{['price', 'discount'].includes(preview.request.command) ? range(row.priceMin, row.priceMax) : ['start', 'stop'].includes(preview.request.command) ? row.stopped ? '판매 중지' : '판매 운영' : status(row)}</td><td>{after(row, preview.request.command)}</td></tr>)}</tbody></GroupTable>
          <p>비교 이후 상품이나 재고가 바뀌면 전체 적용을 중단합니다. 비교 결과는 15분 동안 유효합니다.</p>
          <label className="admin-goods-bulk__check"><input type="checkbox" checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} />대상과 변경 내용을 확인했습니다.</label>
          <div className="admin-goods-bulk__actions"><button className={GROUP_BUTTON} type="button" disabled={locked} onClick={() => { setPreview(null); setAcknowledged(false); }}>다시 입력</button>
            <button className={GROUP_PRIMARY} type="button" disabled={locked || !acknowledged} onClick={commit}>변경사항 저장</button></div>
        </>}
        {resultStatus}
      </div>
    </CustomerServiceDialog> : null}
  </div>;
}
