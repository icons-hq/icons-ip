'use client';
import { useEffect, useRef, useState } from 'react';
import { readGoodsDisplayVisibilityAction } from '@/app/admin/good-reference-actions';
import { GOOD_REFERENCE_LIMIT, GOOD_REFERENCE_MAX_LENGTH } from '@/lib/admin/good-references';
import { displayGoodVisibility, type DisplayGoodInfo, type DisplayGoodVisibility } from '@/lib/admin/good-visibility';

/** 선택기 결과 행처럼 이미 아는 상품(관련상품 찾기 검색 행). */
export interface KnownDisplayGood { id: string; name: string; code: string | null; published: boolean; archived: boolean; visibility?: DisplayGoodVisibility }

const lookupable = (id: string) => Boolean(id) && id === id.trim() && [...id].length <= GOOD_REFERENCE_MAX_LENGTH;

/**
 * 저장된 전시 구성의 상품 URL로 이름·판매자상품코드·고객 화면에 보이지 않는 이유를 한 번에 확인한다(카테고리 전시·캠페인 상품 묶음·홈 전시).
 * 가벼운 읽기(admin_goods_display_visibility)라 상품 URL 1,000개도 수 ms다. 화면을 다시 열어도 상품 URL만 보이지 않게 한다(QA1 MD).
 * 조회에 실패하면 상품 URL로 보이고 편집은 막지 않으며, 다음에 목록이 바뀔 때 다시 확인한다. 응답에 없는 상품 URL은 찾을 수 없음이다.
 * 선택기에서 고른 상품은 `remember`로 바로 넣어 다시 묻지 않는다. 응답은 화면이 열려 있는 동안 늘 반영한다.
 */
export function useGoodReferenceInfo(ids: readonly string[]) {
  const [info, setInfo] = useState<ReadonlyMap<string, DisplayGoodInfo>>(() => new Map());
  const requested = useRef(new Set<string>()), mounted = useRef(true);
  const key = [...new Set(ids)].join('\n');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const unknown = (key ? key.split('\n') : []).filter(id => lookupable(id) && !requested.current.has(id));
    if (!unknown.length) return;
    unknown.forEach(id => requested.current.add(id));
    const forget = (chunk: string[]) => chunk.forEach(id => requested.current.delete(id));
    for (let start = 0; start < unknown.length; start += GOOD_REFERENCE_LIMIT) {
      const chunk = unknown.slice(start, start + GOOD_REFERENCE_LIMIT);
      void readGoodsDisplayVisibilityAction(chunk).then(result => {
        if (!result.ok) { forget(chunk); return; }
        if (!mounted.current) return;
        const found = new Map(result.goods.map(good => [good.id, good]));
        setInfo(current => {
          const next = new Map(current);
          for (const id of chunk) {
            if (next.has(id)) continue;
            const good = found.get(id);
            next.set(id, good ? { name: good.name, code: good.code, visibility: good.visibility } : { name: null, code: null, visibility: 'missing' });
          }
          return next;
        });
      }).catch(() => forget(chunk));
    }
  }, [key]);
  /* 이벤트 처리기에서만 부른다(효과의 의존값이 아니다). */
  function remember(goods: readonly KnownDisplayGood[]) {
    if (!goods.length) return;
    goods.forEach(good => requested.current.add(good.id));
    setInfo(current => {
      const next = new Map(current);
      for (const good of goods) next.set(good.id, { name: good.name, code: good.code, visibility: displayGoodVisibility(good) });
      return next;
    });
  }
  return { info, remember };
}
