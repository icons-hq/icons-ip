import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AddressBookEntry } from '@/lib/address-book';
import { MyAddresses, MyAddressesNotOpen, addressBookReturnFocusIds } from './MyAddresses';

vi.mock('@/components/shell/CardRewardAvailability', () => ({ useCardRewardsEnabled: () => false }));
vi.mock('next/navigation', () => ({ usePathname: () => '/my/addresses', useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/my/addresses/actions', () => ({
  saveAddressBookEntryAction: vi.fn(), setDefaultAddressBookEntryAction: vi.fn(), deleteAddressBookEntryAction: vi.fn(),
}));

const home: AddressBookEntry = {
  id: '7a570000-0000-4000-8000-000000000001', label: '집', recipientName: '홍길동', phone: '01012345678',
  postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동 1203호', isDefault: true,
};
const office: AddressBookEntry = { ...home, id: '7a570000-0000-4000-8000-000000000002', label: '회사', recipientName: '김회사', phone: '0212345678', address1: '서울 강남구 테헤란로 152', address2: null, isDefault: false };

const render = (entries: AddressBookEntry[] | null) => renderToStaticMarkup(<MyAddresses entries={entries} />);

describe('MyAddresses (/my/addresses · 11 §5.8)', () => {
  it('셸 안 배송지 관리 — 헤딩 바, 기본 배송지 요약, 4칸 표(240·393·180·107), 배송지 추가', () => {
    const html = render([home, office]);

    expect(html).toContain('aria-label="마이페이지 메뉴"');
    expect(html).toMatch(/<a aria-current="page" href="\/my\/addresses">배송지 관리<\/a>/);
    expect(html).toContain('<h1 class="wc-mypage__headbar-title" id="address-book-heading" tabindex="-1">배송지 관리</h1>');
    expect(html).toContain('2 / 10');
    expect(html).toContain('<h2 class="wc-address-book__summary-title" id="address-book-default-heading">기본 배송지</h2>');
    expect(html).toContain('집 · (04524) 서울 중구 세종대로 110 101동 1203호');
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*class="wc-address-book__summary-action"[^>]*>기본 배송지 변경<\/button>/);
    for (const col of ['name', 'address', 'phone', 'actions']) expect(html).toContain(`<col class="wc-address-book__col-${col}"/>`);
    expect(html).toContain('<th scope="col">배송지 이름</th><th scope="col">주소</th><th scope="col">연락처</th>');
    /* 기본 배송지가 맨 앞, 잉크 글자 배지. 연락처는 가운데를 가린다. */
    const rows = html.match(/<tr( class="is-default")?><th scope="row">[\s\S]*?<\/tr>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('<strong>집</strong><span class="wc-address-book__badge">기본 배송지</span>');
    expect(rows[0]).toContain('010-****-5678');
    expect(rows[1]).toContain('02-****-5678');
    expect(html).not.toContain('01012345678');
    expect(html).not.toContain('0212345678');
    expect(html).toContain('aria-label="집 수정"');
    expect(html).toContain('aria-label="회사 삭제"');
    expect(html).toMatch(/<button[^>]*class="wc-btn primary"[^>]*>배송지 추가<\/button>/);
    expect(html).not.toContain('wc-address-book__panel');
    expect(html).toContain('회원 탈퇴가 처리되면 주소록도 바로 삭제돼요. 그 전에 여기서 언제든 직접 지울 수 있어요.');
  });

  it('배송지가 하나면 기본 배송지 변경 버튼이 없고, 없으면 빈 상태를 보인다', () => {
    expect(render([home])).not.toContain('기본 배송지 변경');
    const empty = render([]);
    expect(empty).toContain('등록한 배송지가 없어요.');
    expect(empty).toContain('저장한 배송지가 없어요.');
    expect(empty).not.toContain('wc-address-book__table');
    expect(empty).toContain('0 / 10');
  });

  it('상한(10개)에 닿으면 추가를 막고 이유를 버튼에 잇는다', () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ ...office, id: `7a570000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`, label: `주소 ${index + 1}`, isDefault: index === 0 }));
    const html = render(ten);
    expect(html).toMatch(/<button[^>]*aria-describedby="address-book-full-note"[^>]*disabled=""[^>]*>배송지 추가<\/button>/);
    expect(html).toContain('id="address-book-full-note"');
  });

  it('주소록을 읽지 못하면 비었다고 단정하지 않는다', () => {
    const html = render(null);
    expect(html).toContain('배송지를 불러오지 못했어요');
    expect(html).not.toContain('저장한 배송지가 없어요');
    expect(html).not.toContain('배송지 추가');
  });

  it('펼친 영역을 닫으면 연 버튼으로, 그 버튼이 없거나 잠기면 다음 후보·화면 제목으로 포커스를 돌린다', () => {
    expect(addressBookReturnFocusIds({ kind: 'edit', id: home.id })).toEqual([`address-book-edit-${home.id}`, 'address-book-add', 'address-book-heading']);
    expect(addressBookReturnFocusIds({ kind: 'delete', id: home.id })).toEqual([`address-book-delete-${home.id}`, 'address-book-add', 'address-book-heading']);
    expect(addressBookReturnFocusIds({ kind: 'default' })).toEqual(['address-book-default-toggle', 'address-book-add', 'address-book-heading']);
    expect(addressBookReturnFocusIds({ kind: 'add' })).toEqual(['address-book-add', 'address-book-heading']);
    /* 후보 id 가 실제 마크업에 있다. */
    const html = render([home, office]);
    for (const id of [`address-book-edit-${home.id}`, `address-book-delete-${office.id}`, 'address-book-default-toggle', 'address-book-add', 'address-book-heading']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('액션이 목록을 다시 읽지 못하면 서버 화면을 새로 받고, 새 목록(prop)으로 상태를 맞춘다', () => {
    const source = readFileSync(new URL('./MyAddresses.tsx', import.meta.url), 'utf8');
    expect(source).toContain('startRefresh(() => router.refresh())');
    expect(source).toMatch(/if \(serverEntries !== initialEntries\) \{\s*setServerEntries\(initialEntries\);\s*setEntries\(initialEntries\);/);
  });

  it('표 칸은 920 폭에서 LFS 실측(240/393/180/107)이고, 더 좁은 데스크톱 칼럼에서는 칼럼을 넘지 않게 줄어든다', () => {
    const css = readFileSync(new URL('../../app/styles/wc-account-commerce.css', import.meta.url), 'utf8');
    const width = (col: string) => css.match(new RegExp(`\\.wc-address-book__col-${col} \\{ width: ([^;]+); \\}`))?.[1];
    /* 920 × 26.087% = 240, 920 × 19.565% = 180, 관리 107 고정, 주소는 나머지(920 − 527 = 393). */
    expect(width('name')).toBe('26.087%');
    expect(width('phone')).toBe('19.565%');
    expect(width('actions')).toBe('107px');
    expect(width('address')).toBe('auto');
    expect(Math.round(920 * 0.26087) + Math.round(920 * 0.19565) + 107).toBe(920 - 393);
    /* 마이 셸 입력(44)과 같은 줄의 '주소 검색' 버튼 높이를 맞춘다(인증 1칼럼은 40끼리). */
    expect(css).toMatch(/\.wc-mypage \.wc-address-form \.postcode-field-open \{\s*height: 44px;\s*\}/);
    expect(css).toMatch(/\.wc-mypage input:not\(\[type='hidden'\]\)[^{]*\{[^}]*min-height: 44px;/);
  });

  it('오류 문구와 화면에 입력값을 늘어놓지 않는 규율을 소스에서도 지킨다', () => {
    const source = readFileSync(new URL('./MyAddresses.tsx', import.meta.url), 'utf8');
    expect(source).toContain('maskAddressBookPhone(entry.phone)');
    expect(source).not.toMatch(/\{entry\.phone\}/);
    expect(source).not.toMatch(/console\.(log|error)/);
  });
});

/* 주소록을 여는 날(처리방침 주소록 개정 시행일) 전 — 여는 날·지금 주문하는 방법·개정 사전 공지만 안내한다(L7 QA). */
describe('MyAddressesNotOpen', () => {
  it('셸 안에서 여는 날과 개정 사전 공지 링크만 보이고 목록·추가 버튼은 없다', () => {
    const html = renderToStaticMarkup(<MyAddressesNotOpen />);
    expect(html).toContain('<h1 class="wc-mypage__headbar-title" id="address-book-heading" tabindex="-1">배송지 관리</h1>');
    expect(html).toContain('배송지 관리는 2026년 11월 6일부터 이용할 수 있어요.');
    expect(html).toContain('주문서에서 배송지를 입력해주세요');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('개정 사전 공지 보기');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('id="address-book-add"');
  });
});
