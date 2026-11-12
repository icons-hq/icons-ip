'use client';

import { useState } from 'react';
import { Input } from '../kit/ui/input';
import { GOODS_LIST_SEARCH_FIELDS, GOODS_LIST_SEARCH_HINTS, type GoodsListSearchField } from '@/lib/admin/goods-list';

const CHOICE = 'inline-flex min-h-7 cursor-pointer items-center gap-2 text-sm';

/**
 * 상품 검색어 줄(TKT-074): 검색 대상 라디오와 입력 칸. 고른 검색 대상에 맞춰 입력 칸 안내·말풍선·스크린리더 설명이 바뀐다.
 * 라디오와 입력은 지금처럼 GET 폼의 field·q로 제출되고(비제어 입력), 바뀌는 것은 안내 문구뿐이다.
 * 주소의 검색 대상이 바뀌면(초기화 등) 부모가 key로 새로 그린다.
 */
export function GoodsListQueryField({ field, query }: { field: GoodsListSearchField; query: string }) {
  const [selected, setSelected] = useState<GoodsListSearchField>(field);
  const hint = GOODS_LIST_SEARCH_HINTS[selected];
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-2" data-goods-search="query">
    <fieldset className="flex flex-wrap gap-x-4 gap-y-1"><legend className="sr-only">검색 대상</legend>
      {GOODS_LIST_SEARCH_FIELDS.map(item => <label className={CHOICE} key={item.value}>
        <input type="radio" name="field" value={item.value} defaultChecked={field === item.value} onChange={event => { if (event.target.checked) setSelected(item.value); }} />{item.label}
      </label>)}
    </fieldset>
    <Input className="min-w-60 flex-1 basis-60 sm:max-w-xl" id="goods-list-query" type="search" name="q" maxLength={100} defaultValue={query}
      aria-describedby="goods-list-query-hint" placeholder={hint.placeholder} title={hint.title} />
    {/* 안내는 입력 칸의 설명(스크린리더)·말풍선과 아래 목록 안내에 있다 — 화면 줄을 차지하지 않는다. */}
    <p className="sr-only" id="goods-list-query-hint">{hint.title}</p>
  </div>;
}
