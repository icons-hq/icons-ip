import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/app/admin/shipping-notice-template-actions', () => ({ listShippingNoticeTemplateOptionsAction: vi.fn() }));

import { GoodsShippingNoticeField, shippingNoticeRowView, type GoodsShippingNoticeOption } from './GoodsShippingNoticeField';

const option = (code: string, version: number, name: string, shippingNotice = '배송 안내') => ({ id: `${code}-${version}`, code, version, name, shippingNotice, returnExchangeNotice: '교환 안내', csName: 'CS', csPhone: '0212345678', csEmail: 'cs@example.test' }) as GoodsShippingNoticeOption;
const options = [option('BASIC', 2, '기본 안내 A'), option('FIGURE', 1, '피규어 안내')];
/** 고른 것을 보이는 상자에 적힌 글. */
const boxText = (html: string) => html.match(/<input[^>]*id="good-shipping-notice-display"[^>]*>/)?.[0].match(/ value="([^"]*)"/)?.[1];
const hiddenValue = (html: string) => html.match(/<input type="hidden" name="shippingNoticeTemplate" value="([^"]*)"\/>/)?.[1];

describe('배송·교환·반품 안내 템플릿 칸', () => {
  /* 화면 규칙 1: 전체를 늘어놓는 드롭다운 대신 고른 것만 보이고 [템플릿 고르기]로 공용 선택창을 연다. */
  it('드롭다운이 아니라 고른 템플릿의 이름을 상자에 보이고 [템플릿 고르기]를 둔다', () => {
    const html = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="FIGURE@1" />);
    expect(html).not.toContain('<select'); expect(html).not.toContain('<option');
    expect(boxText(html)).toBe('피규어 안내');
    expect(html).toMatch(/<label[^>]*for="good-shipping-notice-display"[^>]*>배송·교환·반품 안내 템플릿<\/label>/);
    expect(html).toMatch(/<button[^>]*name="shippingNoticeTemplate"[^>]*type="button"[^>]*>템플릿 고르기<\/button>|<button[^>]*type="button"[^>]*name="shippingNoticeTemplate"[^>]*>템플릿 고르기<\/button>/);
    /* 고르지 않은 다른 템플릿은 화면에 늘어놓지 않는다. */
    expect(html).not.toContain('기본 안내 A');
  });

  /* 화면 규칙 8: 코드와 버전은 운영자가 할 일이 없는 내부 값이다. 값(코드@버전)은 숨은 칸으로만 제출한다. */
  it('코드·버전은 숨은 칸의 값으로만 보내고 화면 글에는 없다', () => {
    const html = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="FIGURE@1" />);
    expect(hiddenValue(html)).toBe('FIGURE@1');
    const visible = html.replace(/<input type="hidden"[^>]*>/g, '');
    expect(visible).not.toMatch(/BASIC|FIGURE|@|버전/);
  });

  it('고르지 않은 상품은 기본 안내로 보이고 되돌리기 버튼이 없다', () => {
    const html = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="" />);
    expect(boxText(html)).toBe('기본 안내');
    expect(hiddenValue(html)).toBe('');
    expect(html).not.toContain('기본 안내로 되돌리기');
    expect(renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="FIGURE@1" />)).toMatch(/<button[^>]*type="button"[^>]*>기본 안내로 되돌리기<\/button>/);
  });

  it('목록에 없는 예전 안내가 적용 중이면 이름을 그대로 보이고, 바꾸지 않으면 유지된다고 알린다', () => {
    const named = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="LEGACY@1" currentName="예전 안내" />);
    expect(boxText(named)).toBe('예전 안내');
    expect(hiddenValue(named)).toBe('LEGACY@1');
    expect(named).toContain('지금 적용 중인 안내는 템플릿 목록에 없습니다. 바꾸지 않으면 저장해도 그대로 유지됩니다.');
    /* 같은 템플릿을 그 뒤에 고쳤으면(목록에는 지금 내용만 있다) 상품을 저장하면 지금 내용으로 바뀐다고 알린다. 값은 그대로 제출한다. */
    const outdated = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="FIGURE@0" currentName="피규어 안내" />);
    expect(boxText(outdated)).toBe('피규어 안내');
    expect(hiddenValue(outdated)).toBe('FIGURE@0');
    expect(outdated).toContain('이 상품에는 템플릿을 고치기 전 내용이 적용돼 있습니다. 상품을 저장하면 지금 내용으로 바뀝니다.');
    expect(outdated).not.toContain('data-goods-shipping-notice-unlisted');
    const unnamed = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="OLD@3" />);
    expect(boxText(unnamed)).toBe('지금 적용 중인 안내');
    expect(hiddenValue(unnamed)).toBe('OLD@3');
    for (const html of [renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="" />), renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="FIGURE@1" currentName="피규어 안내" />)]) {
      expect(html).not.toContain('data-goods-shipping-notice-unlisted');
    }
  });

  it('칸 아래에 늘 보이는 안내 문단은 없고, 템플릿 관리는 새 탭 링크다', () => {
    const html = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="" />);
    expect(html).not.toContain('<p');
    expect(html).not.toContain('확인이 끝난 템플릿만 고를 수 있습니다');
    expect(html).toMatch(/<a href="\/admin\/settings\/shipping-notices"[^>]*target="_blank"[^>]*>배송 안내 템플릿 관리 ↗<\/a>/);
    const failed = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="" error="배송 안내 템플릿을 다시 선택해주세요." />);
    expect(failed.match(/<p /g)).toHaveLength(1);
    expect(failed).toMatch(/<p[^>]*id="good-shipping-notice-display-error"[^>]*role="alert"[^>]*>배송 안내 템플릿을 다시 선택해주세요\.<\/p>/);
    expect(failed).toMatch(/<input[^>]*aria-invalid="true"[^>]*id="good-shipping-notice-display"/);
  });

  it('선택창 줄은 이름 아래에 배송 안내 첫 줄을 보여 이름이 같은 템플릿을 가린다', () => {
    expect(shippingNoticeRowView(option('BASIC', 2, '기본 안내 A', '  결제 후 2~3일 안에 보냅니다.\n제주는 하루 더 걸립니다.'))).toEqual({ title: '기본 안내 A', meta: '결제 후 2~3일 안에 보냅니다.' });
    expect(shippingNoticeRowView(option('BASIC', 2, '기본 안내 A', '가'.repeat(60))).meta).toBe(`${'가'.repeat(40)}…`);
    expect(shippingNoticeRowView(option('BASIC', 2, '기본 안내 A', '   ')).meta).toBeUndefined();
  });
});
