'use client';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { confirmGoodsGroupConversionAction, previewGoodsGroupConversionAction } from '@/app/admin/goods-group-actions';
import { GOODS_GROUPS_PATH, goodsGroupBlockerLabel, goodsGroupHref, parseGoodsGroupConversionRequest,
  type GoodsGroupConversionRequest, type GoodsGroupPreview, type GoodsGroupSource } from '@/lib/admin/goods-groups';
import { formatWon } from '@/lib/admin/goods-price-editor';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { AdminField, AdminFormGrid, AdminPageHeader, AdminSectionCard, AdminStatusBadge } from './console/AdminKit';
import { AdminSelect } from './console/AdminSelect';
import { Button, buttonVariants } from './kit/ui/button';
import { Input } from './kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './kit/ui/table';
import { GoodsGroupProductPicker, GroupCompleted, GroupOperationStatus, GroupTable, useGoodsGroupOperation, useGoodsGroupSession } from './GoodsGroupOperation';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';

function initialDraft(source: GoodsGroupSource | null): GoodsGroupConversionRequest {
  const optionNames = Object.keys(source?.variants.find(row => Object.keys(row.attributes).length > 0)?.attributes ?? {}).slice(0, 3);
  if (!optionNames.length) optionNames.push('종류');
  return { sourceGoodId: source?.goodId ?? '', name: [...(source?.name ?? '')].slice(0, 40).join(''), optionNames,
    selections: source?.variants.slice(0, 100).map(row => ({ variantId: row.id, values: optionNames.map((name, index) => row.attributes[name] ?? (index === 0 ? row.name : '')) })) ?? [] };
}
const CONVERSION_DESCRIPTION = '한 상품의 선택형 옵션을 각각 독립된 판매옵션으로 전환합니다. 첫 번째 옵션이 기존 상품번호를 유지합니다.';

/** `title`: 화면 머리 제목. 주면 머리(제목·설명·관련 화면 링크)를 이 화면이 그린다. */
export function GoodsGroupConversion({ initialSource, actorId, sessionId, title }: { initialSource: GoodsGroupSource | null; actorId: string; sessionId: string | null; title?: string }) {
  const session = useGoodsGroupSession(actorId, sessionId), identity = sessionId ? { actorId, sessionId } : null;
  const operation = useGoodsGroupOperation(identity, 'convert', session.current, session.deny);
  const [source, setSource] = useState(initialSource), [draft, setDraft] = useState(() => initialDraft(initialSource));
  const [preview, setPreview] = useState<GoodsGroupPreview | null>(null), [approved, setApproved] = useState(false), [error, setError] = useState('');
  const [choosing, setChoosing] = useState(!initialSource), [pending, startTransition] = useTransition(); const sequence = useRef(0), busy = useRef(false);
  const locked = session.blocked || operation.locked || pending || operation.receipt !== null;
  /* 상품을 고르기만 했으면 기본값 그대로라 잃을 입력이 없다. 전환이 끝났거나 로그인이 바뀌면 입력 칸이 사라져 묻지 않는다. */
  const dirty = !session.blocked && operation.receipt?.state !== 'completed' && JSON.stringify(draft) !== JSON.stringify(initialDraft(source));
  useAdminLeaveGuard({ dirty, blocked: operation.pending });
  function change(next: GoodsGroupConversionRequest) { if (locked || !session.current()) return; sequence.current += 1; setDraft(next); setPreview(null); setApproved(false); setError(''); }
  function selectSource(next: GoodsGroupSource) { if (locked || !session.current()) return; setSource(next); setDraft(initialDraft(next)); setChoosing(false); setPreview(null); setApproved(false); setError(''); sequence.current += 1; }
  function toggle(variantId: string) {
    if (!source) return;
    const present = draft.selections.some(row => row.variantId === variantId), variant = source.variants.find(row => row.id === variantId);
    if (!variant || !present && draft.selections.length >= 100) return;
    change({ ...draft, selections: present ? draft.selections.filter(row => row.variantId !== variantId)
      : [...draft.selections, { variantId, values: draft.optionNames.map((name, index) => variant.attributes[name] ?? (index === 0 ? variant.name : '')) }] });
  }
  function move(index: number, delta: number) {
    const next = [...draft.selections], target = index + delta; if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]]; change({ ...draft, selections: next });
  }
  function axes(count: number) { change({ ...draft, optionNames: Array.from({ length: count }, (_, index) => draft.optionNames[index] ?? ''),
    selections: draft.selections.map(row => ({ ...row, values: Array.from({ length: count }, (_, index) => row.values[index] ?? '') })) }); }
  function compare() {
    if (locked || busy.current || !identity || !source || !session.current()) return;
    const request = parseGoodsGroupConversionRequest({ ...draft, name: draft.name.trim(), optionNames: draft.optionNames.map(value => value.trim()),
      selections: draft.selections.map(row => ({ ...row, values: row.values.map(value => value.trim()) })) });
    if (!request) { setError('옵션을 2~100개 선택하고 그룹명·옵션명·옵션값을 입력해주세요. 옵션명과 값의 조합은 중복될 수 없습니다.'); return; }
    const ticket = ++sequence.current; busy.current = true; setError(''); setPreview(null); setApproved(false);
    startTransition(async () => {
      try { const result = await previewGoodsGroupConversionAction(request, identity); if (!session.current() || ticket !== sequence.current) return;
        if ('error' in result) { setError(result.error); if (result.authChanged) session.deny(); } else setPreview(result.value);
      } catch { if (session.current()) setError('변환 전 비교를 완료하지 못했습니다. 현재 입력은 유지됩니다.'); }
      finally { busy.current = false; }
    });
  }
  function confirm() {
    if (locked || !approved || preview?.state !== 'ready' || !identity || !session.current()) return;
    if (Date.parse(preview.expiresAt) <= Date.now()) { setError('비교 결과의 유효시간이 지났습니다. 최신 상품으로 다시 비교해주세요.'); setPreview(null); setApproved(false); return; }
    const metadata = { ...identity, version: 1 as const, command: 'convert' as const, sourceGoodId: preview.plan.sourceGoodId, previewId: preview.previewId, operationId: crypto.randomUUID() };
    operation.execute(metadata, () => confirmGoodsGroupConversionAction(metadata));
  }
  const byId = new Map(source?.variants.map(row => [row.id, row]) ?? []), selectedIds = new Set(draft.selections.map(row => row.variantId));
  const ordered = [...draft.selections.map(row => byId.get(row.variantId)!).filter(Boolean), ...(source?.variants.filter(row => !selectedIds.has(row.id)) ?? [])];
  if (session.blocked) return <p className="text-sm text-destructive" role="alert">로그인 상태가 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.</p>;
  const relatedLinks = <><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={GOODS_GROUPS_PATH}>그룹상품 목록</Link><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={`${GOODS_GROUPS_PATH}/new?mode=assemble`}>기존 상품으로 그룹 구성</Link></>;
  return <section className="flex min-w-0 flex-col gap-4" aria-busy={pending || operation.pending} data-admin-screen="goods-group-conversion">
    {title ? <AdminPageHeader title={title} description={CONVERSION_DESCRIPTION} actions={relatedLinks} />
      : <><div className="flex flex-wrap items-center gap-2">{relatedLinks}</div>
        <p className="max-w-prose text-sm text-muted-foreground">{CONVERSION_DESCRIPTION}</p></>}
    <GroupOperationStatus operation={operation} disabled={session.blocked} />
    {operation.receipt?.state === 'completed' ? <GroupCompleted receipt={operation.receipt} /> : <>
      {operation.receipt?.state === 'sealed' ? <Button className="self-start" variant="outline" type="button" onClick={() => { operation.clearReceipt(); setPreview(null); setApproved(false); }}>입력으로 돌아가 다시 비교</Button> : null}
      {choosing ? <GoodsGroupProductPicker identity={identity} disabled={locked} onSelect={selectSource} /> : null}
      {source ? <><AdminSectionCard title="전환할 원상품"><p className="flex flex-col text-sm"><strong className="font-medium">{source.name}</strong><span className="text-muted-foreground">상품번호 {source.goodId} · 판매자상품코드 {source.code ?? '—'}</span></p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2"><Button variant="outline" type="button" disabled={locked} onClick={() => setChoosing(!choosing)}>{choosing ? '상품 선택 닫기' : '다른 상품 선택'}</Button>
          <Link className="text-sm underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(source.goodId)}`}>상품 관리</Link>{source.groupId ? <Link className="text-sm underline underline-offset-4" href={goodsGroupHref(source.groupId)}>기존 그룹상품 열기</Link> : null}</div>
        {source.blockers.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-destructive" role="alert">{source.blockers.map(value => <li key={value}>{goodsGroupBlockerLabel(value)}</li>)}</ul> : null}
      </AdminSectionCard>
      <form onSubmit={event => { event.preventDefault(); compare(); }}><AdminSectionCard title="그룹명과 판매옵션"><fieldset className="flex min-w-0 flex-col gap-4" disabled={locked || source.blockers.length > 0}>
        <AdminFormGrid><AdminField label="그룹상품명 · 40자" inputId="conversion-group-name"><Input id="conversion-group-name" value={draft.name} maxLength={80} onChange={event => change({ ...draft, name: event.target.value })} /></AdminField>
          <AdminField label="옵션명 개수" inputId="conversion-axis-count"><AdminSelect id="conversion-axis-count" value={draft.optionNames.length} onChange={event => axes(Number(event.target.value))}>{[1, 2, 3].map(count => <option key={count} value={count}>{count}개</option>)}</AdminSelect></AdminField>
          {draft.optionNames.map((name, index) => <AdminField key={index} label={`옵션명 ${index + 1} · 40자`} inputId={`conversion-axis-${index}`}><Input id={`conversion-axis-${index}`} value={name} maxLength={80}
            onChange={event => change({ ...draft, optionNames: draft.optionNames.map((value, at) => at === index ? event.target.value : value) })} placeholder={index === 0 ? '색상' : index === 1 ? '크기' : '용량'} /></AdminField>)}</AdminFormGrid>
        <p className="text-sm text-muted-foreground">선택 {draft.selections.length} / 100개. 선택 순서의 첫 옵션이 기존 상품번호를 유지하며 나머지는 새 상품번호로 분리됩니다.</p>
        <GroupTable label="전환할 옵션과 순서" className="min-w-[720px]"><TableHeader><TableRow><TableHead className="w-10 min-w-10">선택</TableHead><TableHead>기존 옵션</TableHead><TableHead className="text-right">기본 판매가</TableHead><TableHead className="text-right">재고수량</TableHead>{draft.optionNames.map((name, index) => <TableHead key={index}>{name || `옵션명 ${index + 1}`} 값</TableHead>)}<TableHead>순서</TableHead></TableRow></TableHeader><TableBody>
          {ordered.map(variant => { const index = draft.selections.findIndex(row => row.variantId === variant.id), selected = index >= 0; return <TableRow key={variant.id} data-selected={selected} data-state={selected ? 'selected' : undefined}>
            <TableCell className="relative w-10 min-w-10 p-0"><label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" aria-label={`${variant.name} 변환 선택`} checked={selected} disabled={!selected && draft.selections.length >= 100} onChange={() => toggle(variant.id)} /></label></TableCell>
            <TableCell className="whitespace-normal"><span className="flex min-w-32 flex-col items-start gap-1">{variant.name}<small className="text-xs text-muted-foreground">{variant.code ?? '관리코드 없음'}</small>{index === 0 ? <AdminStatusBadge>기존 상품번호 유지</AdminStatusBadge> : null}</span></TableCell>
            <TableCell className="text-right tabular-nums">{formatWon(variant.price)}</TableCell><TableCell className="text-right tabular-nums">{variant.stockQty.toLocaleString('ko-KR')}개</TableCell>
            {draft.optionNames.map((name, axis) => <TableCell className="text-muted-foreground" key={axis}>{selected ? <Input className="min-w-32 text-foreground" aria-label={`${variant.name} ${name || `옵션명 ${axis + 1}`} 값`} value={draft.selections[index].values[axis]} maxLength={160}
              onChange={event => change({ ...draft, selections: draft.selections.map((row, at) => at === index ? { ...row, values: row.values.map((value, valueIndex) => valueIndex === axis ? event.target.value : value) } : row) })} /> : '미선택 · 재고 보존'}</TableCell>)}
            <TableCell>{selected ? <div className="flex items-center gap-1"><Button size="icon-sm" variant="outline" type="button" aria-label={`${variant.name} 위로`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></Button><Button size="icon-sm" variant="outline" type="button" aria-label={`${variant.name} 아래로`} disabled={index === draft.selections.length - 1} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></Button></div> : null}</TableCell>
          </TableRow>; })}</TableBody></GroupTable>
      </fieldset>{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}<Button className="self-start" type="submit" disabled={locked || source.blockers.length > 0}>{pending ? '비교 중…' : '변환 전 변경사항 비교'}</Button></AdminSectionCard></form>
      {preview?.state === 'blocked' ? <AdminSectionCard title="전환 전에 확인할 사항"><ul className="list-disc space-y-1 pl-5 text-sm text-destructive" role="alert">{preview.blockers.map(value => <li key={value}>{goodsGroupBlockerLabel(value)}</li>)}</ul><p className="text-sm text-muted-foreground">관련 상태를 처리한 뒤 상품을 다시 선택하고 비교해주세요.</p></AdminSectionCard> : null}
      {preview?.state === 'ready' ? <AdminSectionCard title="변환 전 최종 비교"><GroupTable label="전환 결과 비교" className="min-w-[640px]"><TableHeader><TableRow><TableHead>기존 옵션</TableHead><TableHead>변환 후 상품명</TableHead><TableHead>상품번호</TableHead><TableHead className="text-right">기본 판매가</TableHead><TableHead className="text-right">재고수량</TableHead></TableRow></TableHeader><TableBody>
        {preview.plan.members.map(row => <TableRow key={row.sourceVariantId}><TableCell className="whitespace-normal">{row.sourceVariantName}</TableCell><TableCell className="whitespace-normal">{row.name}</TableCell><TableCell>{row.retainsGoodId ? `${row.goodId} 유지` : '새 상품번호 발급'}</TableCell><TableCell className="text-right tabular-nums">{formatWon(row.price)}</TableCell><TableCell className="text-right tabular-nums">{row.stockQty.toLocaleString('ko-KR')}개</TableCell></TableRow>)}</TableBody></GroupTable>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground"><li>선택하지 않은 옵션 {preview.plan.unselectedOptions.length}개는 원상품에 판매 중지 상태로 남기며, 재고 {preview.plan.unselectedOptions.reduce((sum, row) => sum + row.stockQty, 0).toLocaleString('ko-KR')}개를 보존합니다.</li>
          <li>원상품을 포함한 모든 결과 상품은 미공개로 바뀌며 KC 재검토가 필요합니다.</li><li>기존 주문·결제·리뷰 이력은 원래 상품번호에 남습니다.</li><li>원상품의 합산 할인·배송비·구매한도는 계속 함께 적용됩니다.</li><li>기존 장바구니에서 중지된 옵션은 다시 선택해야 합니다.</li></ul>
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={approved} disabled={locked} onChange={event => setApproved(event.target.checked)} /> 비교 내용과 미공개·KC 재검토 전환을 확인했습니다.</label>
        <Button className="self-start" type="button" disabled={locked || !approved} onClick={confirm}>{operation.pending ? '처리 중…' : '이 내용으로 그룹 전환'}</Button>
      </AdminSectionCard> : null}</> : null}
    </>}
  </section>;
}
