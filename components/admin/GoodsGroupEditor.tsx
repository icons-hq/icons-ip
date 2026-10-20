'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { archiveGoodsGroupAction, readGoodsGroupAction, saveGoodsGroupAction } from '@/app/admin/goods-group-actions';
import { GOODS_GROUPS_PATH, goodsGroupConversionHref, parseGoodsGroupValues, type GoodsGroupSnapshot, type GoodsGroupSource, type GoodsGroupValues } from '@/lib/admin/goods-groups';
import { formatWon } from '@/lib/admin/goods-price-editor';
import { goodsGroupCommonHref } from '@/lib/admin/goods-group-common';
import { AdminField, AdminFormGrid, AdminSectionCard, AdminStatusBadge } from './console/AdminKit';
import { GROUP_BUTTON, GROUP_PRIMARY, GoodsGroupProductPicker, GroupCompleted, GroupOperationStatus, GroupTable, useGoodsGroupOperation, useGoodsGroupSession } from './GoodsGroupOperation';

const valuesOf = (group: GoodsGroupSnapshot | null): GoodsGroupValues => group ? { name: group.name, optionNames: [...group.optionNames], members: group.members.map(row => ({ goodId: row.goodId, values: [...row.values] })) } : { name: '', optionNames: ['종류'], members: [] };
type Product = { name: string; code: string | null; price: number; stockQty: number };
export function GoodsGroupEditor({ initial, newGroupId, actorId, sessionId }: { initial: GoodsGroupSnapshot | null; newGroupId: string; actorId: string; sessionId: string | null }) {
  const session = useGoodsGroupSession(actorId, sessionId), identity = sessionId ? { actorId, sessionId } : null;
  const operation = useGoodsGroupOperation(identity, initial ? `group:${initial.id}` : 'create', session.current, session.deny);
  const [stored, setStored] = useState(initial), [values, setValues] = useState(() => valuesOf(initial));
  const [known, setKnown] = useState(() => new Map<string, Product>(initial?.members.map(row => [row.goodId, row]) ?? []));
  const [picker, setPicker] = useState(!initial), [comparison, setComparison] = useState<GoodsGroupValues | null>(null), [approved, setApproved] = useState(false), [archiveReview, setArchiveReview] = useState(false);
  const [error, setError] = useState(''), [pending, startTransition] = useTransition();
  const locked = session.blocked || operation.locked || operation.receipt !== null || pending || Boolean(stored?.archivedAt);
  const dirty = operation.receipt?.state !== 'completed' && JSON.stringify(values) !== JSON.stringify(valuesOf(stored));
  useEffect(() => {
    if (!dirty && !pending && !operation.pending) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (pending || operation.pending || !window.confirm('저장하지 않은 그룹상품 구성을 두고 이동할까요?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', prevent); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', prevent); document.removeEventListener('click', navigate, true); };
  }, [dirty, pending, operation.pending]);
  function leave(event: { preventDefault: () => void }) {
    if (pending || operation.pending) event.preventDefault();
  }
  function change(next: GoodsGroupValues) { if (locked || !session.current()) return; setValues(next); setComparison(null); setApproved(false); setArchiveReview(false); setError(''); }
  function add(source: GoodsGroupSource) {
    if (locked || !session.current()) return;
    if (source.groupId && source.groupId !== stored?.id) { setError('이미 다른 그룹상품에 연결되어 있습니다. 기존 그룹에서 제외한 뒤 선택해주세요.'); return; }
    if (source.variants.length !== 1) { setError('기본 옵션이 하나인 상품을 선택해주세요. 선택형 옵션이 여러 개라면 그룹 전환으로 분리할 수 있습니다.'); return; }
    if (values.members.some(row => row.goodId === source.goodId)) { setError('이미 선택한 상품입니다.'); return; }
    if (values.members.length >= 100) { setError('그룹상품은 최대 100개 판매옵션으로 구성할 수 있습니다.'); return; }
    setKnown(current => new Map(current).set(source.goodId, { name: source.name, code: source.code, price: source.variants[0].price, stockQty: source.variants[0].stockQty }));
    change({ ...values, members: [...values.members, { goodId: source.goodId, values: values.optionNames.map(() => '') }] });
  }
  function move(index: number, delta: number) { const members = [...values.members], target = index + delta; if (target < 0 || target >= members.length) return;
    [members[index], members[target]] = [members[target], members[index]]; change({ ...values, members }); }
  function compare() {
    if (locked) return;
    const parsed = parseGoodsGroupValues({ ...values, name: values.name.trim(), optionNames: values.optionNames.map(value => value.trim()), members: values.members.map(row => ({ ...row, values: row.values.map(value => value.trim()) })) }, stored ? 1 : 2);
    if (!parsed) { setError(`그룹명·옵션명·옵션값과 ${stored ? '1~100' : '2~100'}개 상품 구성을 확인해주세요. 같은 옵션값 조합은 중복될 수 없습니다.`); return; }
    setComparison(parsed); setApproved(false); setArchiveReview(false); setError('');
  }
  function save() {
    if (locked || !comparison || !approved || !identity) return;
    const metadata = { ...identity, version: 1 as const, command: stored ? 'update' as const : 'create' as const,
      groupId: stored?.id ?? newGroupId, expectedRevision: stored?.revision ?? 0, operationId: crypto.randomUUID() };
    operation.execute(metadata, () => saveGoodsGroupAction(metadata, comparison));
  }
  function archive() {
    if (locked || !stored || !archiveReview || !identity) return;
    const metadata = { ...identity, version: 1 as const, command: 'archive' as const, groupId: stored.id, expectedRevision: stored.revision, operationId: crypto.randomUUID() };
    operation.execute(metadata, () => archiveGoodsGroupAction(metadata));
  }
  function reload() {
    if (!stored || !identity || operation.locked || session.blocked || pending || !session.current()) return;
    if (JSON.stringify(values) !== JSON.stringify(valuesOf(stored)) && !window.confirm('현재 입력을 두고 최신 저장본을 불러올까요?')) return;
    startTransition(async () => {
      try { const result = await readGoodsGroupAction(stored.id, identity); if (!session.current()) return;
        if ('error' in result) { setError(result.error); if (result.authChanged) session.deny(); }
        else { setStored(result.value); setValues(valuesOf(result.value)); setKnown(new Map(result.value.members.map(row => [row.goodId, row]))); setComparison(null); setApproved(false); setArchiveReview(false); setError(''); }
      } catch { if (session.current()) setError('최신 저장본을 불러오지 못했습니다. 현재 입력은 유지됩니다.'); }
    });
  }
  if (session.blocked) return <p role="alert">로그인 상태가 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.</p>;
  const removed = stored?.members.filter(row => !values.members.some(member => member.goodId === row.goodId)) ?? [];
  const navigationGroup = operation.receipt?.state === 'completed' ? operation.receipt.group : stored;
  return <section className="wc-admin-kit admin-console" aria-busy={pending || operation.pending}>
    {!initial ? <nav className="admin-good-editor-tabs admin-group-registration-tabs" aria-label="상품 등록 방식"><Link href="/admin/catalog/goods?create=1" onNavigate={leave}>상품 등록</Link><span aria-current="page">그룹상품 등록</span></nav> : null}
    <div className="wc-admin-kit__actions"><Link className={GROUP_BUTTON} href={GOODS_GROUPS_PATH} onNavigate={leave}>그룹상품 목록</Link><Link className={GROUP_BUTTON} href={goodsGroupConversionHref()} onNavigate={leave}>선택형 옵션에서 그룹 전환</Link>
      {navigationGroup && !navigationGroup.archivedAt ? <Link className={GROUP_BUTTON} href={goodsGroupCommonHref(navigationGroup)} onNavigate={leave}>공통정보 편집</Link> : null}
      {stored ? <button className={GROUP_BUTTON} type="button" disabled={operation.locked || pending || session.blocked} onClick={reload}>최신 저장본 불러오기</button> : null}</div>
    <p className="wc-admin-kit__description">기본 옵션 하나를 가진 상품들을 판매옵션으로 연결합니다. 상품별 가격·재고와 기존 합산 조건은 유지됩니다.</p>
    <GroupOperationStatus operation={operation} disabled={session.blocked} />
    {operation.receipt?.state === 'completed' ? <GroupCompleted receipt={operation.receipt}>{initial && !operation.receipt.group.archivedAt ? <button className={GROUP_BUTTON} type="button" onClick={() => {
      if (operation.receipt?.state !== 'completed') return; const group = operation.receipt.group;
      setStored(group); setValues(valuesOf(group)); setKnown(new Map(group.members.map(row => [row.goodId, row]))); setComparison(null); setApproved(false); setPicker(false); operation.clearReceipt();
    }}>이 저장본으로 계속 편집</button> : null}</GroupCompleted> : <>
      {operation.receipt?.state === 'sealed' ? <button className={GROUP_BUTTON} type="button" onClick={() => { operation.clearReceipt(); setComparison(null); setApproved(false); setArchiveReview(false); }}>입력으로 돌아가기</button> : null}
      {stored?.archivedAt ? <AdminSectionCard title="연결 해제된 그룹상품"><p>이 그룹은 연결을 해제했습니다. 개별 상품과 원상품의 합산 조건은 유지됩니다.</p></AdminSectionCard> : null}
      {picker && !stored?.archivedAt ? <GoodsGroupProductPicker identity={identity} disabled={locked} onSelect={add} /> : null}
      <form onSubmit={event => { event.preventDefault(); compare(); }}><AdminSectionCard title={stored ? stored.name : '새 그룹상품 구성'}><fieldset disabled={locked}>
        <AdminFormGrid><AdminField label="그룹상품명 · 40자" inputId="group-name"><input id="group-name" value={values.name} maxLength={80} onChange={event => change({ ...values, name: event.target.value })} /></AdminField>
          <AdminField label="옵션명 개수" inputId="group-axis-count"><select id="group-axis-count" value={values.optionNames.length} onChange={event => { const count = Number(event.target.value); change({ ...values,
            optionNames: Array.from({ length: count }, (_, index) => values.optionNames[index] ?? ''), members: values.members.map(row => ({ ...row, values: Array.from({ length: count }, (_, index) => row.values[index] ?? '') })) }); }}>{[1, 2, 3].map(count => <option key={count} value={count}>{count}개</option>)}</select></AdminField>
          {values.optionNames.map((name, index) => <AdminField key={index} label={`옵션명 ${index + 1} · 40자`} inputId={`group-axis-${index}`}><input id={`group-axis-${index}`} value={name} maxLength={80} onChange={event => change({ ...values, optionNames: values.optionNames.map((value, at) => at === index ? event.target.value : value) })} /></AdminField>)}</AdminFormGrid>
        <div className="wc-admin-kit__actions"><span>판매옵션 {values.members.length} / 100개</span><button className={GROUP_BUTTON} type="button" onClick={() => setPicker(!picker)}>{picker ? '상품 선택 닫기' : '상품 추가'}</button></div>
        <GroupTable label="그룹상품 판매옵션 구성"><thead><tr><th>상품</th><th>가격·재고</th>{values.optionNames.map((name, index) => <th key={index}>{name || `옵션명 ${index + 1}`} 값</th>)}<th>순서·제외</th></tr></thead><tbody>
          {values.members.map((row, index) => { const product = known.get(row.goodId); return <tr key={row.goodId}><td>{product?.name ?? row.goodId}<br /><small>{product?.code ?? row.goodId}</small>
            {stored?.commonGoodId === row.goodId ? <><br /><AdminStatusBadge>공통정보 기준 상품</AdminStatusBadge></> : null}<br /><Link href={`/admin/catalog/goods?goodId=${encodeURIComponent(row.goodId)}`} onNavigate={leave}>상품 관리</Link></td>
            <td>{product ? <>{formatWon(product.price)}<br />재고 {product.stockQty.toLocaleString('ko-KR')}개</> : '저장 시 확인'}</td>
            {values.optionNames.map((name, axis) => <td key={axis}><div className="wc-admin-kit__field"><input className="admin-goods-group-option-value" aria-label={`${product?.name ?? row.goodId} ${name || `옵션명 ${axis + 1}`} 값`} value={row.values[axis]} maxLength={160}
              onChange={event => change({ ...values, members: values.members.map((member, at) => at === index ? { ...member, values: member.values.map((value, offset) => offset === axis ? event.target.value : value) } : member) })} /></div></td>)}
            <td><div className="wc-admin-kit__actions"><button className={GROUP_BUTTON} type="button" disabled={index === 0} aria-label={`${product?.name ?? row.goodId} 위로`} onClick={() => move(index, -1)}>↑</button><button className={GROUP_BUTTON} type="button" disabled={index === values.members.length - 1} aria-label={`${product?.name ?? row.goodId} 아래로`} onClick={() => move(index, 1)}>↓</button>
              <button className={GROUP_BUTTON} type="button" onClick={() => change({ ...values, members: values.members.filter(member => member.goodId !== row.goodId) })}>{product?.name ?? row.goodId} 제외</button></div></td></tr>; })}
          {!values.members.length ? <tr><td colSpan={3 + values.optionNames.length}>연결할 상품을 선택해주세요.</td></tr> : null}</tbody></GroupTable>
      </fieldset>{error ? <p role="alert">{error}</p> : null}<div className="wc-admin-kit__actions"><button className={GROUP_PRIMARY} type="submit" disabled={locked}>변경사항 확인</button><Link className={GROUP_BUTTON} href={GOODS_GROUPS_PATH} onNavigate={leave}>취소</Link></div></AdminSectionCard></form>
      {comparison ? <AdminSectionCard title="저장 전 확인"><p>{comparison.name} · {comparison.members.length}개 판매옵션</p><ul>
        <li>이름은 그룹상품명과 옵션값을 합쳐 저장합니다. 구성 상품 전체가 미공개로 바뀌고 KC 재검토가 필요합니다.</li>
        <li>제외할 상품 {removed.length}개는 개별 상품으로 남습니다. 상품을 합치거나 재고를 옮기지 않습니다.</li><li>공통 상품정보가 서로 같은 상품만 연결할 수 있습니다.</li><li>기존 합산 할인·배송비·구매한도는 그대로 적용됩니다.</li></ul>
        <GroupTable label="저장할 판매옵션"><thead><tr><th>상품번호</th><th>저장할 상품명</th></tr></thead><tbody>{comparison.members.map(row => <tr key={row.goodId}><td>{row.goodId}</td><td>{comparison.name} {row.values.join(' / ')}</td></tr>)}</tbody></GroupTable>
        <label><input type="checkbox" checked={approved} disabled={locked} onChange={event => setApproved(event.target.checked)} /> 변경 내용과 미공개·KC 재검토를 확인했습니다.</label>
        <button className={GROUP_PRIMARY} type="button" disabled={locked || !approved} onClick={save}>이 구성으로 저장</button></AdminSectionCard> : null}
      {stored && !stored.archivedAt ? <AdminSectionCard title="그룹 연결 해제"><p>그룹 연결을 모두 해제합니다. 개별 상품의 번호·가격·재고와 기존 합산 조건은 유지됩니다.</p>
        <label><input type="checkbox" checked={archiveReview} disabled={locked} onChange={event => { setArchiveReview(event.target.checked); setComparison(null); setApproved(false); }} /> 그룹 연결만 해제하는 것을 확인했습니다.</label>
        <button className={GROUP_BUTTON} type="button" disabled={locked || !archiveReview} onClick={archive}>그룹 연결 해제</button></AdminSectionCard> : null}
    </>}
  </section>;
}
