import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { kstDateTimeText } from '@/lib/admin/list-export';
import type { ShippingNoticeTemplate } from '@/lib/admin/shipping-notice-templates';
import { ShippingNoticeTemplatesScreen } from './ShippingNoticeTemplatesScreen';

vi.mock('@/app/admin/shipping-notice-template-actions', () => ({
  saveShippingNoticeTemplateAction: vi.fn(),
  readShippingNoticeTemplateAction: vi.fn(),
  applyShippingNoticeTemplateToGoodsAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const template = (overrides: Partial<ShippingNoticeTemplate> = {}): ShippingNoticeTemplate => ({
  id: 'b9000000-0000-4000-8000-000000000001', code: 'n-3fa9c21b7d04', version: 7, name: '기본 배송 안내',
  shippingNotice: '결제한 날부터 2~3일 안에 보냅니다.\n둘째 줄은 목록에 보이지 않습니다.', returnExchangeNotice: '교환·반품 안내', remoteAreaNotice: '제주는 하루 더 걸립니다.',
  csName: '엑스스퀘어 CS', csPhone: '02-000-0000', csEmail: 'help@example.com', status: 'active', updatedAt: '2026-11-26T01:00:00+00:00', goodsCount: 1234,
  ...overrides,
});
const draft = template({ id: 'b9000000-0000-4000-8000-000000000002', code: 'basic-v3', version: 3, name: '예전에 만들던 안내', shippingNotice: '', status: 'draft', goodsCount: 0 });
const screen = (templates: ShippingNoticeTemplate[], query = '', total = templates.length) =>
  renderToStaticMarkup(<ShippingNoticeTemplatesScreen data={{ total, filters: { query, page: 1 }, templates }} />);
/** 표의 본문 줄(HTML). */
const rows = (html: string) => html.match(/<tbody[\s\S]*<\/tbody>/)?.[0].match(/<tr[\s\S]*?<\/tr>/g) ?? [];
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/button>/g)].map((match) => match[1]);
/** 화면에 보이는 글자(태그·속성 제외). */
const visible = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');

describe('배송 안내 템플릿 관리 화면', () => {
  it('한 줄이 템플릿 하나다 — 이름, 배송 안내 첫 줄, 쓰는 상품 수, 수정일, [수정]·[상품에 적용]', () => {
    const html = screen([template(), draft]);
    const [first = '', second = ''] = rows(html);
    expect(rows(html)).toHaveLength(2);
    expect(first).toContain('기본 배송 안내');
    expect(first).toContain('결제한 날부터 2~3일 안에 보냅니다.');
    expect(first).not.toContain('둘째 줄');
    expect(first).toContain('1,234개');
    expect(first).toContain(kstDateTimeText('2026-11-26T01:00:00+00:00').replaceAll('-', '.'));
    expect(buttons(first)).toEqual(['수정', '상품에 적용']);
    for (const head of ['템플릿 이름', '배송 안내', '쓰는 상품', '수정일', '관리']) expect(html).toMatch(new RegExp(`<th[^>]*>${head}</th>`));
    /* 예전 방식으로 만들어 두고 켜지 않은 템플릿은 '준비 중'으로 보이고, [수정]에서 저장해야 상품에 적용할 수 있다. */
    expect(second).toContain('준비 중');
    expect(second).toContain('없음');
    expect(buttons(second)).toEqual(['수정']);
    expect(first).not.toContain('준비 중');
  });

  /* 화면 규칙 8·N-1·N-7: 코드, 버전, 내부 번호와 '초안·활성·확인 근거'는 화면에 없다. */
  it('코드·버전·내부 번호와 예전 단계의 말은 화면에 없다', () => {
    const html = screen([template(), draft]);
    for (const hidden of ['n-3fa9c21b7d04', 'basic-v3', 'b9000000-0000-4000-8000-000000000001', '버전', '코드', '초안', '활성', '근거', 'name="code"', 'name="version"', 'name="confirmationEvidence"', 'name="good"', '상품 찾기', '상품 ID']) {
      expect(html, hidden).not.toContain(hidden);
    }
    expect(visible(html)).not.toMatch(/v\d|\b7\b|@/);
    /* 목록 안에 펼치는 수정 폼·미리보기·활성화 칸은 없다. 수정은 [수정] 창에서 한다. */
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('고객 공개 미리보기');
  });

  it('머리는 무엇을 다루는 화면인지 한 줄로 말하고, 등록은 오른쪽 버튼 하나다', () => {
    const html = screen([template()]);
    expect(html).toContain('data-admin-screen="shipping-notices"');
    expect(html).toMatch(/<h2[^>]*>배송 안내 템플릿 관리<\/h2>/);
    expect(html).toContain('상품 상세에 보이는 배송·교환·반품 안내 글입니다. 배송비와 출고지는 ‘배송정보 템플릿 관리’에서 정합니다.');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>(?:<svg[\s\S]*?<\/svg>)?배송 안내 템플릿 등록<\/button>/);
    /* 늘 떠 있던 안내 상자와 목록 설명은 없다. 결과 한 줄은 결과가 있을 때만 채워진다. */
    expect(html).not.toContain('data-admin-notice');
    expect(html).toMatch(/<div aria-live="polite"[^>]*data-shipping-notice-result=""[^>]*><\/div>/);
  });

  it('조회 조건은 템플릿 이름 하나이고, 검색했을 때만 [초기화]가 보인다', () => {
    const plain = screen([template()]);
    expect(plain).toMatch(/<form[^>]*action="\/admin\/settings\/shipping-notices"/);
    expect(plain.match(/<input[^>]*type="search"[^>]*>/g)).toHaveLength(1);
    expect(plain).toMatch(/<label[^>]*for="shipping-notice-template-query"[^>]*>템플릿 이름 검색<\/label>/);
    expect(plain).toMatch(/<button[^>]*type="submit"[^>]*>검색<\/button>/);
    expect(plain).not.toContain('>초기화<');
    const searched = screen([template()], '기본');
    expect(searched).toMatch(/<a[^>]*href="\/admin\/settings\/shipping-notices"[^>]*>초기화<\/a>/);
    expect(searched).toMatch(/<input[^>]*value="기본"/);
  });

  it('빈 목록은 검색했는지에 맞춰 다음에 할 일을 말한다', () => {
    expect(screen([])).toContain('아직 템플릿이 없습니다. [배송 안내 템플릿 등록]으로 만들어 주세요.');
    expect(screen([], '없는 이름')).toContain('조건에 맞는 템플릿이 없습니다.');
  });

  it('목록 머리에 전체 개수를 보이고 20개씩 넘긴다', () => {
    const html = screen([template()], '기본', 45);
    expect(visible(html).replace(/\s+/g, '')).toContain('목록(총45개)');
    expect(html).toContain('/admin/settings/shipping-notices?q=%EA%B8%B0%EB%B3%B8&amp;page=2');
  });
});
