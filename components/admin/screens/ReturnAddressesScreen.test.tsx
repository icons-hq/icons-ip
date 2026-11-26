import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/app/admin/return-address-actions', () => ({ saveReturnAddressAction: vi.fn(), deleteReturnAddressAction: vi.fn() }));
import { ReturnAddressesScreen } from './ReturnAddressesScreen';
import type { ReturnAddress } from '@/lib/admin/return-addresses';

const text = (html: string) => html.replace(/<[^>]+>/g, '');
const address = (patch: Partial<ReturnAddress> = {}): ReturnAddress => ({
  id: '00000000-0000-4000-8000-000000000001', name: '서울 센터', address: '서울시 중구 1', phone: '02-1234-5678', updatedAt: '2026-11-26T00:00:00Z', goodsCount: 0, goods: [], ...patch,
});
const screen = (addresses: ReturnAddress[], canEdit = true) => renderToStaticMarkup(<ReturnAddressesScreen addresses={addresses} canEdit={canEdit} />);

describe('반품/교환지 관리 화면의 이름과 글 (A-1·A-5·A-6)', () => {
  const html = screen([address()]);
  it('한 화면에서 반품/교환지라는 이름 하나로 부른다 — 옛 이름 반품지가 없다', () => {
    expect(text(html)).not.toContain('반품지');
    for (const name of ['반품/교환지 관리', '반품/교환지 목록', '반품/교환지 이름', '반품/교환지 저장', '반품/교환지 추가', '반품/교환지 등록', '반품/교환지 삭제']) expect(text(html), name).toContain(name);
  });
  it('늘 떠 있던 세 문장은 한 줄로 줄었고, 어느 반품·교환부터 새 주소를 쓰는지 말한다', () => {
    expect(text(html)).toContain('고친 주소는 앞으로 승인하는 반품·교환부터 쓰입니다. 이미 승인한 건의 회수 주소는 바뀌지 않습니다.');
    expect(text(html)).not.toMatch(/반품별로 나눠|반품지별|이미 접수된/);
    expect(html.match(/data-admin-notice="info"/g)).toHaveLength(1);
  });
  it('출고지의 기본 반품 주소를 고치는 곳은 글 대신 관련 화면 링크로 보인다', () => {
    expect(html).toContain('href="/admin/settings/origins"');
    expect(text(html)).toContain('배송정보 관리');
    expect(text(html)).toContain('상품에서 고르지 않으면 출고지의 반품 주소를 씁니다.');
  });
  it('조회 전용 계정에는 한 이름(최고 관리자)으로 말하고 저장 버튼과 삭제 버튼은 없다', () => {
    const viewer = screen([address()], false);
    expect(text(viewer)).toContain('이 계정은 볼 수만 있습니다. 바꾸려면 최고 관리자에게 요청해 주세요.');
    expect(text(viewer)).not.toContain('매니저');
    expect(viewer).not.toMatch(/반품\/교환지 (저장|등록|삭제|추가)/);
    expect(viewer).toContain('readOnly');
  });
  it('주소록이 비어 있으면 모든 상품이 출고지 반품 주소를 쓴다고 말하고 추가 폼이 열려 있다', () => {
    const empty = screen([]);
    expect(text(empty)).toContain('등록한 반품/교환지가 없습니다. 모든 상품이 출고지 반품 주소를 씁니다.');
    expect(empty).toMatch(/<details[^>]*open=""/);
  });
});

describe('지울 수 없는 까닭 (A-3)', () => {
  it('고른 상품이 있으면 몇 개인지와 그 상품 이름을 상품 수정으로 가는 링크로 보이고 삭제 버튼은 없다', () => {
    const html = screen([address({ goodsCount: 2, goods: [{ id: 'good-a', name: '상품 A', archived: false }, { id: 'good-b', name: '상품 B', archived: true }] })]);
    expect(text(html)).toContain('이 반품/교환지를 고른 상품 2개가 있어 지울 수 없습니다. 그 상품의 반품/교환지를 먼저 바꿔 주세요.');
    expect(html).toContain('href="/admin/catalog/goods?goodId=good-a"');
    expect(html).toContain('href="/admin/catalog/goods?goodId=good-b"');
    expect(text(html)).toContain('상품 B (보관)');
    expect(text(html)).not.toContain('상품 A (보관)');
    expect(text(html)).not.toMatch(/외 \d+개/);
    expect(html).not.toContain('반품/교환지 삭제');
  });
  it('이름을 다 싣지 못한 만큼은 외 N개로 줄인다', () => {
    const goods = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: `상품 ${id}`, archived: false }));
    const html = screen([address({ goodsCount: 12, goods })]);
    expect(text(html)).toContain('외 7개');
    expect(text(html)).toContain('고른 상품 12개');
  });
  it('고른 상품이 없으면 삭제 버튼이 있고, 눌렀을 때 확인창은 공용 확인창(adminConfirm)이 뜬다', () => {
    const html = screen([address()]);
    expect(html).toContain('반품/교환지 삭제');
    expect(text(html)).not.toContain('지울 수 없습니다');
    /* 옛 화면은 kit AlertDialog를 직접 썼다 — 다른 어드민 화면과 같은 확인창을 쓴다(A-4). */
    const source = readFileSync(join(__dirname, 'ReturnAddressesScreen.tsx'), 'utf8');
    expect(source).toContain('adminConfirm(returnAddressDeleteConfirm(entry.name))');
    expect(source).not.toMatch(/AlertDialog|alert-dialog|window\.confirm/);
  });
});
