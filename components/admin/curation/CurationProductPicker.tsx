'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
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
  return <dialog
    aria-labelledby={titleId}
    className="admin-store-editor__dialog"
    onCancel={(event) => { event.preventDefault(); if (!closeDisabled) onClose(); }}
    ref={dialogRef}
  >
    <header><h2 id={titleId}>{title}</h2><button aria-label="닫기" disabled={closeDisabled} onClick={onClose} type="button">×</button></header>
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
    <div className="admin-store-editor__picker-search">
      <label>상품명 / 상품코드<input onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="상품명 또는 상품코드를 입력하세요" value={query} /></label>
      <button onClick={() => { setQuery(''); setPage(1); }} type="button">초기화</button>
    </div>
    <GoodUrlAddField onAdd={(id) => {
      const option = options.find((candidate) => candidate.id === id && !candidate.archivedAt);
      if (!option) return { ok: false, message: GOOD_URL_ERRORS.notFound };
      if (selection.includes(id)) return { ok: false, message: GOOD_URL_ERRORS.exists };
      if (selection.length >= limit) return { ok: false, message: `최대 ${limit}개까지 선택할 수 있습니다.` };
      setSelection((current) => current.includes(id) ? current : [...current, id]);
      return { ok: true, message: `'${option.title}' 상품을 선택했습니다. 선택 완료를 눌러 반영해주세요.` };
    }} />
    <div className="admin-store-editor__picker-summary"><span>조회 결과 <strong>{matches.length}</strong>개</span><span>선택 <strong>{selection.length}</strong> / {limit}개</span></div>
    <div className="admin-store-editor__picker-table">
      <table>
        <caption className="sr-only">전시할 상품 목록</caption>
        <thead><tr><th>선택</th><th>이미지</th><th>상품명 / 상품코드</th>{reviewStatistics ? <th>평점 / 리뷰 수</th> : null}<th>판매가</th><th>노출 상태</th></tr></thead>
        <tbody>{rows.map((option) => {
          const good = goodsById.get(option.id);
          const checked = selection.includes(option.id);
          const image = imageUrlFromBg(good?.imageBg);
          return <tr key={option.id}>
            <td><input aria-label={`${option.title} 선택`} checked={checked} disabled={!checked && selection.length >= limit} onChange={() => setSelection((current) => checked ? current.filter((id) => id !== option.id) : [...current, option.id])} type="checkbox" /></td>
            <td>{image ? (
              // Existing catalog URLs are already optimized and may be local upload previews.
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={image} />
            ) : <span className="admin-store-editor__no-image">이미지 없음</span>}</td>
            <td><strong>{option.title}</strong><span>{option.id}</span></td>
            {reviewStatistics ? <td>{ratingsById.get(option.id)?.average.toFixed(2) ?? '—'} / {ratingsById.get(option.id)?.count ?? 0}개</td> : null}
            <td>{good ? krw(good.price) : '—'}</td>
            <td>{good ? good.soldOut ? '품절' : '노출 중' : '비노출'}</td>
          </tr>;
        })}</tbody>
      </table>
      {rows.length === 0 ? <p className="admin-store-editor__empty">조회된 상품이 없습니다.</p> : null}
    </div>
    <nav aria-label="상품 선택 페이지" className="admin-store-editor__picker-pages">
      <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} type="button">이전</button>
      <span>{currentPage} / {pageCount}</span>
      <button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} type="button">다음</button>
    </nav>
    <footer><button onClick={onClose} type="button">취소</button><button className="admin-store-editor__primary" onClick={() => onApply(selection)} type="button">선택 완료</button></footer>
  </CurationEditorDialog>;
}
