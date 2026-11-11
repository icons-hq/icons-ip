'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import { GOOD_URL_ERRORS } from '@/lib/admin/good-url';
import { GoodUrlAddField } from '@/components/admin/GoodUrlAddField';
import type { HomeGoodsCard } from '@/lib/home-catalog';
import { imageUrlFromBg } from '@/lib/media';
import { krw } from '@/lib/format';
import { homeReviewBandRating, type HomeReviewStatistic } from '@/lib/home-ranking';

export function CurationEditorDialog({ title, children, onClose, closeDisabled = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  /* 네이티브 dialog(showModal)가 포커스 가두기·Esc·닫은 뒤 포커스 복귀를 맡는다. 모양만 kit Dialog와 같다.
     본문 바닥의 <footer>는 이 팝업이 버튼 줄로 배치한다. */
  return <dialog
    aria-labelledby={titleId}
    className="m-auto max-h-[calc(100dvh-3rem)] w-[min(900px,calc(100vw-2rem))] overflow-y-auto rounded-xl border-0 bg-popover p-0 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none backdrop:bg-black/50 [&>footer]:flex [&>footer]:flex-wrap [&>footer]:justify-end [&>footer]:gap-2 [&>footer]:border-t [&>footer]:px-5 [&>footer]:py-4"
    onCancel={(event) => { event.preventDefault(); if (!closeDisabled) onClose(); }}
    ref={dialogRef}
  >
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-popover px-5 py-3"><h2 className="text-base leading-none font-semibold text-foreground" id={titleId}>{title}</h2><Button aria-label="닫기" disabled={closeDisabled} onClick={onClose} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" /></Button></header>
    {children}
  </dialog>;
}

export function CurationProductPicker({ options, goods, selectedIds, limit, onApply, onClose, reviewStatistics }: {
  options: AdminCurationTargetRecord[];
  goods: HomeGoodsCard[];
  selectedIds: string[];
  limit: number;
  onApply: (ids: string[]) => void;
  onClose: () => void;
  reviewStatistics?: HomeReviewStatistic[];
}) {
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState(selectedIds);
  const [page, setPage] = useState(1);
  const goodsById = useMemo(() => new Map(goods.map((good) => [good.id, good])), [goods]);
  /* 평점 열은 공개 홈 리뷰 BEST가 선정·표시에 쓰는 값이다 — 그룹 범위 요약(reviewSummary)이 있으면 그것, 없으면 굿즈 단위 집계. */
  const ratingsById = useMemo(() => new Map((reviewStatistics ?? []).map((row) => [row.goodId,
    homeReviewBandRating({ ratingAverage: row.ratingAverage, reviewCount: row.reviewCount, reviewSummary: goodsById.get(row.goodId)?.reviewSummary })])), [reviewStatistics, goodsById]);
  const matches = options.filter((option) => !option.archivedAt
    && `${option.title} ${option.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  const pageCount = Math.max(1, Math.ceil(matches.length / 20));
  const currentPage = Math.min(page, pageCount);
  const rows = matches.slice((currentPage - 1) * 20, currentPage * 20);

  return <CurationEditorDialog title="전시 상품 선택" onClose={onClose}>
    <div className="flex flex-wrap items-end gap-2 bg-muted/40 px-5 py-5">
      <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">상품명 / 상품코드<Input onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="상품명 또는 상품코드를 입력하세요" value={query} /></label>
      <Button onClick={() => { setQuery(''); setPage(1); }} type="button" variant="ghost">초기화</Button>
    </div>
    <div className="px-5"><GoodUrlAddField<string> onAdd={(id) => {
      const option = options.find((candidate) => candidate.id === id && !candidate.archivedAt);
      if (!option) return { ok: false, message: GOOD_URL_ERRORS.notFound };
      if (selection.includes(id)) return { ok: false, message: GOOD_URL_ERRORS.exists };
      if (selection.length >= limit) return { ok: false, message: `최대 ${limit}개까지 선택할 수 있습니다.` };
      setSelection((current) => current.includes(id) ? current : [...current, id]);
      return { ok: true, message: `'${option.title}' 상품을 선택했습니다. 선택 완료를 눌러 반영해주세요.` };
    }} bulk={{
      /* 검색 목록과 같은 후보(보관 제외)에 있는 상품만 담는다. */
      capacity: limit - selection.length,
      classify: (match) => {
        if (!options.some((candidate) => candidate.id === match.id && !candidate.archivedAt)) return { ok: false, reason: '이 목록에서 고를 수 없는 상품입니다.' };
        if (selection.includes(match.id)) return { ok: false, reason: GOOD_URL_ERRORS.exists };
        return { ok: true, id: match.id, item: match.id };
      },
      onAdd: (ids) => setSelection((current) => [...current, ...ids.filter((id) => !current.includes(id))].slice(0, limit)),
      appliedHint: '선택 완료를 눌러 반영해주세요.',
    }} /></div>
    <div className="flex justify-between gap-3 px-5 py-4 text-sm"><span>조회 결과 <strong className="font-semibold tabular-nums">{matches.length}</strong>개</span><span>선택 <strong className="font-semibold tabular-nums">{selection.length}</strong> / {limit}개</span></div>
    <div className="mx-5 overflow-hidden rounded-lg border [&>[data-slot=table-container]]:max-h-[48dvh]">
      <Table className="min-w-[620px] text-xs">
        <caption className="sr-only">전시할 상품 목록</caption>
        <TableHeader className="sticky top-0 z-10 bg-muted"><TableRow className="hover:bg-transparent"><TableHead>선택</TableHead><TableHead>이미지</TableHead><TableHead>상품명 / 상품코드</TableHead>{reviewStatistics ? <TableHead className="text-right">평점 / 리뷰 수</TableHead> : null}<TableHead className="text-right">판매가</TableHead><TableHead>노출 상태</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map((option) => {
          const good = goodsById.get(option.id);
          const checked = selection.includes(option.id);
          const image = imageUrlFromBg(good?.imageBg);
          return <TableRow data-state={checked ? 'selected' : undefined} key={option.id}>
            <TableCell><input aria-label={`${option.title} 선택`} checked={checked} disabled={!checked && selection.length >= limit} onChange={() => setSelection((current) => checked ? current.filter((id) => id !== option.id) : [...current, option.id])} type="checkbox" /></TableCell>
            <TableCell>{image ? (
              // Existing catalog URLs are already optimized and may be local upload previews.
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" className="block size-12 rounded-md bg-muted object-contain" src={image} />
            ) : <span className="text-muted-foreground">이미지 없음</span>}</TableCell>
            <TableCell className="whitespace-normal"><strong className="block font-medium [overflow-wrap:anywhere]">{option.title}</strong><span className="block text-[11px] text-muted-foreground">{option.id}</span></TableCell>
            {reviewStatistics ? <TableCell className="text-right tabular-nums">{ratingsById.get(option.id)?.average.toFixed(2) ?? '—'} / {ratingsById.get(option.id)?.count ?? 0}개</TableCell> : null}
            <TableCell className="text-right tabular-nums">{good ? krw(good.price) : '—'}</TableCell>
            <TableCell>{good ? good.soldOut ? '품절' : '노출 중' : '비노출'}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
      {rows.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">조회된 상품이 없습니다.</p> : null}
    </div>
    <div className="px-5 py-3.5"><ConsolePagination label="상품 선택 페이지" page={currentPage} pageSize={20} total={matches.length} unit="개" onPageChange={setPage} /></div>
    <footer><Button onClick={onClose} type="button" variant="outline">취소</Button><Button onClick={() => onApply(selection)} type="button">선택 완료</Button></footer>
  </CurationEditorDialog>;
}
