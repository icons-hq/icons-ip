'use client';

import Link from 'next/link';
import { useId } from 'react';
import { ListingNav } from '@/components/shop/ListingNav';
import { SHOP_SORT_LABELS, type ShopSort } from '@/lib/shop-catalog';

export interface ListingHeaderTab {
  /** 탭을 가르는 안정 키(정렬 키·기간 키·전시 노드 id). */
  key: string;
  label: string;
  href: string;
  selected: boolean;
}

export interface ListingHeaderSort {
  value: ShopSort;
  options: readonly ShopSort[];
  onChange: (sort: ShopSort) => void;
}

export interface ListingHeaderProps {
  title: string;
  /** 제목 아래 작은 줄 — 3단계 전시 이름("› 이름")처럼 현재 위치를 더 좁힌 값. */
  subtitle?: string | null;
  tabs?: readonly ListingHeaderTab[];
  /** 탭 줄의 이름(`<nav aria-label>`). 탭이 있을 때 쓴다. */
  tabsLabel?: string;
  /** 없으면 셀렉트를 그리지 않는다(NEW 는 탭 줄이 곧 정렬이다). */
  sort?: ListingHeaderSort | null;
  /** 제목 요소 단계. 화면에 이미 h1(IP관 배너 등)이 있으면 2 를 준다. 기본은 h1. */
  headingLevel?: 1 | 2;
  /** 제목 요소 id(`aria-labelledby` 대상). */
  headingId?: string;
}

/*
 * 목록 머리 — 제목(32 Bold) + 탭 줄 + 오른쪽 정렬 셀렉트 (X SQUARE · 스펙 C §2.1, Figma New·Best·Category 프레임).
 *
 * 탭은 URL 을 바꾸는 링크다(ARIA tablist 가 아니다) — 현재 탭은 `aria-current="page"`. 정렬은 네이티브 `<select>`이고
 * 선택 즉시 호출부(`onChange`)가 URL 이동을 맡는다. 모바일(750 미만)은 제목 줄 오른쪽에 셀렉트, 탭 줄은 그 아래 한 줄 가로 스크롤이다.
 * 제목·탭·셀렉트·부제가 한 그리드의 직접 자식이라 두 배치(데스크톱 한 줄 / 모바일 두 줄)를 영역 이름만으로 바꾼다(wc-listing.css).
 */
export function ListingHeader({ headingId, headingLevel = 1, sort, subtitle, tabs, tabsLabel = '하위 분류', title }: ListingHeaderProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h1';
  const sortId = useId();
  const visibleTabs = tabs && tabs.length > 0 ? tabs : null;
  return (
    <header className="wc-listing-head">
      <Heading className="wc-listing-head__title" id={headingId}>{title}</Heading>
      {visibleTabs ? (
        <ListingNav activeKey={visibleTabs.find((tab) => tab.selected)?.key ?? ''} className="wc-listing-tabs" label={tabsLabel}>
          <ul className="wc-listing-tabs__list">
            {visibleTabs.map((tab) => (
              <li className="wc-listing-tabs__item" key={tab.key}>
                <Link aria-current={tab.selected ? 'page' : undefined} className="wc-listing-tabs__link" href={tab.href} scroll={false}>{tab.label}</Link>
              </li>
            ))}
          </ul>
        </ListingNav>
      ) : null}
      {sort ? (
        <div className="wc-listing-sort">
          <label className="wc-sr-only" htmlFor={sortId}>정렬 기준</label>
          <select
            className="wc-listing-sort__select"
            id={sortId}
            onChange={(event) => sort.onChange(event.target.value as ShopSort)}
            value={sort.value}
          >
            {sort.options.map((option) => (
              <option key={option} value={option}>{SHOP_SORT_LABELS[option]}</option>
            ))}
          </select>
        </div>
      ) : null}
      {subtitle ? <p className="wc-listing-head__sub">{`› ${subtitle}`}</p> : null}
    </header>
  );
}
