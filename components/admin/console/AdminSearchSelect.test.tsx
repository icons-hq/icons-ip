import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminSearchSelect, filterAdminSearchSelectOptions, findAdminSearchSelectOption, type AdminSearchSelectOption } from './AdminSearchSelect';

const options: AdminSearchSelectOption[] = [
  { value: 'keyring', label: '문구 > 키링', keywords: '문구>키링' },
  { value: 'photo', label: '문구 > 포토카드', keywords: '문구>포토카드 PC-01' },
  { value: 'cup', label: '리빙 > 머그컵' },
];
const pinned: AdminSearchSelectOption[] = [{ value: '', label: '연결 안 함' }];

describe('검색', () => {
  it('낱말을 모두 포함한 항목만 순서대로 남기고, 빈 검색어는 전체다', () => {
    expect(filterAdminSearchSelectOptions(options, '   ')).toBe(options);
    expect(filterAdminSearchSelectOptions(options, '키링').map((option) => option.value)).toEqual(['keyring']);
    expect(filterAdminSearchSelectOptions(options, '카드 문구').map((option) => option.value)).toEqual(['photo']);
    expect(filterAdminSearchSelectOptions(options, '문구').map((option) => option.value)).toEqual(['keyring', 'photo']);
    expect(filterAdminSearchSelectOptions(options, '없는말')).toEqual([]);
  });

  it('붙여 쓴 경로·코드(keywords)와 전각·대소문자 차이도 찾는다', () => {
    expect(filterAdminSearchSelectOptions(options, '문구>키링').map((option) => option.value)).toEqual(['keyring']);
    expect(filterAdminSearchSelectOptions(options, 'pc-01').map((option) => option.value)).toEqual(['photo']);
    expect(filterAdminSearchSelectOptions(options, 'ＰＣ－０１').map((option) => option.value)).toEqual(['photo']);
  });
});

describe('지금 값 찾기', () => {
  it('고정 항목을 먼저 보고, 없는 값이면 undefined다', () => {
    expect(findAdminSearchSelectOption('', pinned, options)?.label).toBe('연결 안 함');
    expect(findAdminSearchSelectOption('photo', pinned, options)?.label).toBe('문구 > 포토카드');
    expect(findAdminSearchSelectOption('gone', pinned, options)).toBeUndefined();
    const stale = [...pinned, { value: 'photo', label: '보관된 값' }];
    expect(findAdminSearchSelectOption('photo', stale, options)?.label).toBe('보관된 값');
  });
});

describe('닫힌 칸', () => {
  const noop = vi.fn();

  it('지금 값을 보여 주는 버튼 하나만 그리고 선택지는 그리지 않는다', () => {
    const html = renderToStaticMarkup(<AdminSearchSelect aria-label="키링 분류" onValueChange={noop} options={options} pinnedOptions={pinned} value="photo" />);
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="키링 분류"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('문구 &gt; 포토카드');
    for (const hidden of ['문구 &gt; 키링', '리빙 &gt; 머그컵', '연결 안 함', '<option', 'cmdk']) expect(html).not.toContain(hidden);
  });

  it('고를 수 있는 값이 없으면 안내 글자를 보이고, 처리 중에는 잠근다', () => {
    const html = renderToStaticMarkup(<AdminSearchSelect aria-label="분류" disabled onValueChange={noop} options={options} placeholder="카테고리 선택" value="gone" />);
    expect(html).toContain('카테고리 선택');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it('항목 수가 늘어도 닫힌 칸의 DOM은 그대로다', () => {
    const many = Array.from({ length: 300 }, (_, index) => ({ value: `v${index}`, label: `항목 ${index}` }));
    const count = (list: AdminSearchSelectOption[]) => renderToStaticMarkup(<AdminSearchSelect aria-label="분류" onValueChange={noop} options={list} value="v0" />).match(/<[a-z]/g)?.length;
    expect(count(many)).toBe(count(many.slice(0, 1)));
  });
});
