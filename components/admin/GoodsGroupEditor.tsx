'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { archiveGoodsGroupAction, readGoodsGroupAction, saveGoodsGroupAction } from '@/app/admin/goods-group-actions';
import { GOODS_GROUPS_PATH, goodsGroupConversionHref, parseGoodsGroupValues, type GoodsGroupSnapshot, type GoodsGroupSource, type GoodsGroupValues } from '@/lib/admin/goods-groups';
import { formatWon } from '@/lib/admin/goods-price-editor';
import { goodsGroupCommonHref } from '@/lib/admin/goods-group-common';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { AdminField, AdminFormGrid, AdminSectionCard, AdminStatusBadge } from './console/AdminKit';
import { AdminSelect } from './console/AdminSelect';
import { Button, buttonVariants } from './kit/ui/button';
import { Input } from './kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './kit/ui/table';
import { GoodsGroupProductPicker, GroupCompleted, GroupOperationStatus, GroupTable, useGoodsGroupOperation, useGoodsGroupSession } from './GoodsGroupOperation';

/* 셸의 콘솔 전환과 같은 탭 모양(템플릿 룩, ADR-0028). */
const TAB = 'inline-flex h-7 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm';
const CHECK = 'flex cursor-pointer items-center gap-2 text-sm';

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
  if (session.blocked) return <p className="text-sm text-destructive" role="alert">로그인 상태가 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.</p>;
  const removed = stored?.members.filter(row => !values.members.some(member => member.goodId === row.goodId)) ?? [];
  const navigationGroup = operation.receipt?.state === 'completed' ? operation.receipt.group : stored;
  return <section className="flex min-w-0 flex-col gap-4" aria-busy={pending || operation.pending} data-admin-screen="goods-group-editor">
    {!initial ? <nav className="inline-flex w-fit rounded-lg bg-muted p-0.5" aria-label="상품 등록 방식"><Link className={TAB} href="/admin/catalog/goods?create=1" onNavigate={leave}>상품 등록</Link><span aria-current="page" className={TAB}>그룹상품 등록</span></nav> : null}
    <div className="flex flex-wrap items-center gap-2"><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={GOODS_GROUPS_PATH} onNavigate={leave}>그룹상품 목록</Link><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={goodsGroupConversionHref()} onNavigate={leave}>선택형 옵션에서 그룹 전환</Link>
      {navigationGroup && !navigationGroup.archivedAt ? <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={goodsGroupCommonHref(navigationGroup)} onNavigate={leave}>공통정보 편집</Link> : null}
      {stored ? <Button variant="outline" type="button" disabled={operation.locked || pending || session.blocked} onClick={reload}>최신 저장본 불러오기</Button> : null}</div>
    <p className="max-w-prose text-sm text-muted-foreground">기본 옵션 하나를 가진 상품들을 판매옵션으로 연결합니다. 상품별 가격·재고와 기존 합산 조건은 유지됩니다.</p>
    <GroupOperationStatus operation={operation} disabled={session.blocked} />
    {operation.receipt?.state === 'completed' ? <GroupCompleted receipt={operation.receipt}>{initial && !operation.receipt.group.archivedAt ? <Button variant="outline" type="button" onClick={() => {
      if (operation.receipt?.state !== 'completed') return; const group = operation.receipt.group;
      setStored(group); setValues(valuesOf(group)); setKnown(new Map(group.members.map(row => [row.goodId, row]))); setComparison(null); setApproved(false); setPicker(false); operation.clearReceipt();
    }}>이 저장본으로 계속 편집</Button> : null}</GroupCompleted> : <>
      {operation.receipt?.state === 'sealed' ? <Button className="self-start" variant="outline" type="button" onClick={() => { operation.clearReceipt(); setComparison(null); setApproved(false); setArchiveReview(false); }}>입력으로 돌아가기</Button> : null}
      {stored?.archivedAt ? <AdminSectionCard title="연결 해제된 그룹상품"><p className="text-sm">이 그룹은 연결을 해제했습니다. 개별 상품과 원상품의 합산 조건은 유지됩니다.</p></AdminSectionCard> : null}
      {picker && !stored?.archivedAt ? <GoodsGroupProductPicker identity={identity} disabled={locked} onSelect={add} /> : null}
      <form onSubmit={event => { event.preventDefault(); compare(); }}><AdminSectionCard title={stored ? stored.name : '새 그룹상품 구성'}><fieldset className="flex min-w-0 flex-col gap-4" disabled={locked}>
        <AdminFormGrid><AdminField label="그룹상품명 · 40자" inputId="group-name"><Input id="group-name" value={values.name} maxLength={80} onChange={event => change({ ...values, name: event.target.value })} /></AdminField>
          <AdminField label="옵션명 개수" inputId="group-axis-count"><AdminSelect id="group-axis-count" value={values.optionNames.length} onChange={event => { const count = Number(event.target.value); change({ ...values,
            optionNames: Array.from({ length: count }, (_, index) => values.optionNames[index] ?? ''), members: values.members.map(row => ({ ...row, values: Array.from({ length: count }, (_, index) => row.values[index] ?? '') })) }); }}>{[1, 2, 3].map(count => <option key={count} value={count}>{count}개</option>)}</AdminSelect></AdminField>
          {values.optionNames.map((name, index) => <AdminField key={index} label={`옵션명 ${index + 1} · 40자`} inputId={`group-axis-${index}`}><Input id={`group-axis-${index}`} value={name} maxLength={80} onChange={event => change({ ...values, optionNames: values.optionNames.map((value, at) => at === index ? event.target.value : value) })} /></AdminField>)}</AdminFormGrid>
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm tabular-nums">판매옵션 {values.members.length} / 100개</span><Button size="sm" variant="outline" type="button" onClick={() => setPicker(!picker)}>{picker ? '상품 선택 닫기' : '상품 추가'}</Button></div>
        <GroupTable label="그룹상품 판매옵션 구성" className="min-w-[720px]"><TableHeader><TableRow><TableHead>상품</TableHead><TableHead>가격·재고</TableHead>{values.optionNames.map((name, index) => <TableHead key={index}>{name || `옵션명 ${index + 1}`} 값</TableHead>)}<TableHead>순서·제외</TableHead></TableRow></TableHeader><TableBody>
          {values.members.map((row, index) => { const product = known.get(row.goodId); return <TableRow key={row.goodId}><TableCell className="whitespace-normal"><span className="flex min-w-36 flex-col items-start gap-1">{product?.name ?? row.goodId}<small className="text-xs text-muted-foreground">{product?.code ?? row.goodId}</small>
            {stored?.commonGoodId === row.goodId ? <AdminStatusBadge>공통정보 기준 상품</AdminStatusBadge> : null}<Link className="text-sm underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(row.goodId)}`} onNavigate={leave}>상품 관리</Link></span></TableCell>
            <TableCell className="tabular-nums">{product ? <span className="flex flex-col">{formatWon(product.price)}<span>재고 {product.stockQty.toLocaleString('ko-KR')}개</span></span> : '저장 시 확인'}</TableCell>
            {values.optionNames.map((name, axis) => <TableCell key={axis}><Input className="min-w-32" aria-label={`${product?.name ?? row.goodId} ${name || `옵션명 ${axis + 1}`} 값`} value={row.values[axis]} maxLength={160}
              onChange={event => change({ ...values, members: values.members.map((member, at) => at === index ? { ...member, values: member.values.map((value, offset) => offset === axis ? event.target.value : value) } : member) })} /></TableCell>)}
            <TableCell><div className="flex items-center gap-1"><Button size="icon-sm" variant="outline" type="button" disabled={index === 0} aria-label={`${product?.name ?? row.goodId} 위로`} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></Button><Button size="icon-sm" variant="outline" type="button" disabled={index === values.members.length - 1} aria-label={`${product?.name ?? row.goodId} 아래로`} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></Button>
              <Button size="sm" variant="outline" type="button" onClick={() => change({ ...values, members: values.members.filter(member => member.goodId !== row.goodId) })}>{product?.name ?? row.goodId} 제외</Button></div></TableCell></TableRow>; })}
          {!values.members.length ? <TableRow><TableCell className="h-24 text-center text-muted-foreground" colSpan={3 + values.optionNames.length}>연결할 상품을 선택해주세요.</TableCell></TableRow> : null}</TableBody></GroupTable>
      </fieldset>{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}<div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={locked}>변경사항 확인</Button><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={GOODS_GROUPS_PATH} onNavigate={leave}>취소</Link></div></AdminSectionCard></form>
      {comparison ? <AdminSectionCard title="저장 전 확인"><p className="text-sm">{comparison.name} · {comparison.members.length}개 판매옵션</p><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>이름은 그룹상품명과 옵션값을 합쳐 저장합니다. 구성 상품 전체가 미공개로 바뀌고 KC 재검토가 필요합니다.</li>
        <li>제외할 상품 {removed.length}개는 개별 상품으로 남습니다. 상품을 합치거나 재고를 옮기지 않습니다.</li><li>공통 상품정보가 서로 같은 상품만 연결할 수 있습니다.</li><li>기존 합산 할인·배송비·구매한도는 그대로 적용됩니다.</li></ul>
        <GroupTable label="저장할 판매옵션"><TableHeader><TableRow><TableHead>상품번호</TableHead><TableHead>저장할 상품명</TableHead></TableRow></TableHeader><TableBody>{comparison.members.map(row => <TableRow key={row.goodId}><TableCell>{row.goodId}</TableCell><TableCell className="whitespace-normal">{comparison.name} {row.values.join(' / ')}</TableCell></TableRow>)}</TableBody></GroupTable>
        <label className={CHECK}><input type="checkbox" checked={approved} disabled={locked} onChange={event => setApproved(event.target.checked)} /> 변경 내용과 미공개·KC 재검토를 확인했습니다.</label>
        <Button className="self-start" type="button" disabled={locked || !approved} onClick={save}>이 구성으로 저장</Button></AdminSectionCard> : null}
      {stored && !stored.archivedAt ? <AdminSectionCard title="그룹 연결 해제"><p className="text-sm">그룹 연결을 모두 해제합니다. 개별 상품의 번호·가격·재고와 기존 합산 조건은 유지됩니다.</p>
        <label className={CHECK}><input type="checkbox" checked={archiveReview} disabled={locked} onChange={event => { setArchiveReview(event.target.checked); setComparison(null); setApproved(false); }} /> 그룹 연결만 해제하는 것을 확인했습니다.</label>
        <Button className="self-start" variant="destructive" type="button" disabled={locked || !archiveReview} onClick={archive}>그룹 연결 해제</Button></AdminSectionCard> : null}
    </>}
  </section>;
}
