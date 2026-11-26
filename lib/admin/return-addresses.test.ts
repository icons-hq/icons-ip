import { describe, expect, it } from 'vitest';
import {
  RETURN_ADDRESS_APPROVAL_NOTE, RETURN_ADDRESS_FIELD_LABELS, normalizeReturnAddressInput, parseReturnAddressRows, returnAddressDeleteConfirm, returnAddressErrorMessage,
  returnAddressGoodHref, returnAddressOptionLabel, returnAddressSavedMessage,
} from './return-addresses';

const ID = '00000000-0000-4000-8000-000000000001';
const row = (patch: Record<string, unknown> = {}) => ({ id: ID, name: '서울 센터', address: '서울시 중구 1', phone: '02-1234-5678', updated_at: '2026-11-26T00:00:00Z', ...patch });

describe('반품/교환지 이름 (A-1)', () => {
  it('칸 이름과 입력 오류는 모두 반품/교환지라 부르고 옛 이름 반품지를 쓰지 않는다', () => {
    expect(RETURN_ADDRESS_FIELD_LABELS).toEqual({ name: '반품/교환지 이름', address: '주소', phone: '연락처' });
    const bad = normalizeReturnAddressInput({ name: '', address: '', phone: 'x' }) as { ok: false; errors: Record<string, string> };
    expect(bad.errors.name).toBe('반품/교환지 이름을 60자 이내로 입력해 주세요.');
    const all = [...Object.values(bad.errors), ...['42501', 'return_address_name_taken', 'return_address_conflict', 'return_address_in_use', 'return_address_not_found', 'invalid_return_address', 'other']
      .flatMap((code) => [returnAddressErrorMessage({ code: code === '42501' ? code : undefined, message: code }), returnAddressErrorMessage({ message: code }, 'delete')]),
    returnAddressSavedMessage(3), returnAddressSavedMessage(0), returnAddressSavedMessage(null), RETURN_ADDRESS_APPROVAL_NOTE, ...Object.values(returnAddressDeleteConfirm('서울 센터'))
      .filter((value): value is string => typeof value === 'string')];
    for (const message of all) expect(message, message).not.toMatch(/반품지|매니저/);
  });
});

describe('오류 문구는 고칠 방법까지 말한다', () => {
  it('다른 사람이 먼저 바꿨을 때는 낱말 표의 말을 쓴다(충돌·버전·다른 관리자가 아니다)', () => {
    expect(returnAddressErrorMessage({ message: 'return_address_conflict' })).toBe('다른 사람이 먼저 바꿨습니다. 입력한 내용을 복사해 둔 뒤 새로고침해 최신 내용을 확인해 주세요.');
  });
  it('상품이 쓰는 반품/교환지는 못 지우는 까닭과 먼저 할 일을 말한다', () => {
    expect(returnAddressErrorMessage({ message: 'return_address_in_use' }, 'delete')).toBe('이 반품/교환지를 고른 상품이 있어 지울 수 없습니다. 그 상품의 반품/교환지를 먼저 바꿔 주세요.');
  });
  it('까닭을 모르는 오류는 하던 일(저장·삭제)에 맞춰 말한다', () => {
    expect(returnAddressErrorMessage({ message: 'boom' })).toBe('반품/교환지를 저장하지 못했습니다. 입력한 내용은 그대로 있습니다. 잠시 뒤 다시 해 주세요.');
    expect(returnAddressErrorMessage({ message: 'boom' }, 'delete')).toBe('반품/교환지를 지우지 못했습니다. 잠시 뒤 다시 해 주세요.');
    expect(returnAddressErrorMessage({ code: '42501' })).toBe('반품/교환지 변경은 최고 관리자만 할 수 있습니다.');
  });
});

describe('저장 결과와 영향 (A-2·A-6)', () => {
  it('고친 주소는 이 반품/교환지를 고른 상품 수와 함께 바로 보인다고 말한다', () => {
    expect(returnAddressSavedMessage(3)).toBe('저장했습니다. 이 반품/교환지를 고른 상품 3개의 상세 화면에 바로 보입니다.');
    expect(returnAddressSavedMessage(1200)).toBe('저장했습니다. 이 반품/교환지를 고른 상품 1,200개의 상세 화면에 바로 보입니다.');
    expect(returnAddressSavedMessage(0)).toBe('저장했습니다. 이 반품/교환지를 고른 상품은 아직 없습니다.');
    /* 수를 읽지 못해도 저장은 끝났다 — 수만 빼고 말한다. */
    expect(returnAddressSavedMessage(null)).toBe('저장했습니다. 이 반품/교환지를 고른 상품의 상세 화면에 바로 보입니다.');
  });
  it('화면 위 한 줄은 어느 반품·교환부터 새 주소를 쓰는지 말한다 — 승인할 때 정해지므로 앞으로 승인하는 건부터다', () => {
    expect(RETURN_ADDRESS_APPROVAL_NOTE).toBe('고친 주소는 앞으로 승인하는 반품·교환부터 쓰입니다. 이미 승인한 건의 회수 주소는 바뀌지 않습니다.');
    /* '접수된 반품'은 틀린 말이다 — 접수만 하고 승인 전인 요청은 승인할 때의 주소를 쓴다. */
    expect(RETURN_ADDRESS_APPROVAL_NOTE).not.toContain('접수');
  });
});

describe('삭제 확인창 (A-4)', () => {
  it('무엇이 되돌아오지 않고 무엇이 그대로인지 말하고, 버튼은 하는 일의 이름이다', () => {
    expect(returnAddressDeleteConfirm('서울 센터')).toEqual({
      title: '‘서울 센터’ 반품/교환지를 삭제할까요?',
      message: '삭제하면 되돌릴 수 없습니다. 이 반품/교환지를 고른 상품은 없고, 이미 승인한 반품·교환의 회수 주소는 그대로 남습니다. 삭제 기록은 감사 기록에 남습니다.',
      confirmLabel: '삭제', cancelLabel: '돌아가기', destructive: true,
    });
  });
});

describe('주소록 읽기 결과', () => {
  it('상품 수와 상품 목록을 주소마다 붙이고, 없으면 0과 빈 목록이다', () => {
    const goods = [{ id: 'good-a', name: '상품 A', archived: false }];
    expect(parseReturnAddressRows([row(), row({ id: '00000000-0000-4000-8000-000000000002' })], new Map([[ID, 7]]), new Map([[ID, goods]])))
      .toEqual([
        { id: ID, name: '서울 센터', address: '서울시 중구 1', phone: '02-1234-5678', updatedAt: '2026-11-26T00:00:00Z', goodsCount: 7, goods },
        { id: '00000000-0000-4000-8000-000000000002', name: '서울 센터', address: '서울시 중구 1', phone: '02-1234-5678', updatedAt: '2026-11-26T00:00:00Z', goodsCount: 0, goods: [] },
      ]);
  });
  it('모양이 어긋난 줄이 있으면 지어내지 않고 실패(null)다', () => {
    expect(parseReturnAddressRows([row({ id: 'not-uuid' })])).toBeNull();
    expect(parseReturnAddressRows([row({ phone: 1 })])).toBeNull();
    expect(parseReturnAddressRows(null)).toBeNull();
  });
  it('상품 편집기가 쓰는 선택지 문장과 상품 수정 링크는 그대로다', () => {
    expect(returnAddressOptionLabel({ id: ID, name: '서울 센터', address: '서울시 중구 1' })).toBe('서울 센터 · 서울시 중구 1');
    expect(returnAddressGoodHref('good-a')).toBe('/admin/catalog/goods?goodId=good-a');
    expect(returnAddressGoodHref('a b')).toBe('/admin/catalog/goods?goodId=a%20b');
  });
});
