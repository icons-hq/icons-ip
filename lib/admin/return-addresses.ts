import { isUuid } from '@/lib/uuid';

/*
 * 반품/교환지 주소록(S36-040). 상품이 고르는 반품지이고, 상품에서 비우면 출고지 설정의 반품 주소를 쓴다.
 * 저장·삭제의 최종 판정(권한·이름 중복·낙관적 잠금·사용 중 삭제)은 DB RPC(admin_save_return_address·
 * admin_delete_return_address)가 하고, 여기서는 화면이 같은 규칙으로 먼저 걸러 입력값을 지킨다.
 */
export const RETURN_ADDRESSES_PATH = '/admin/settings/return-addresses';

export interface ReturnAddress {
  id: string;
  name: string;
  address: string;
  phone: string;
  updatedAt: string;
  /** 이 주소를 반품지로 고른 상품 수. 0이 아니면 지울 수 없다. */
  goodsCount: number;
}

/** 상품 편집기 선택지. 비우면 출고지 반품 주소다. */
export type ReturnAddressOption = Pick<ReturnAddress, 'id' | 'name' | 'address'>;

export const RETURN_ADDRESS_FIELD_LABELS = { name: '반품지 이름', address: '주소', phone: '연락처' } as const;
export type ReturnAddressField = keyof typeof RETURN_ADDRESS_FIELD_LABELS;
export type ReturnAddressValues = Record<ReturnAddressField, string>;

const CONTROL = /[\u0000-\u001f\u007f]/u;
const PHONE = /^[0-9][0-9-]{6,18}[0-9]$/u;

export function normalizeReturnAddressInput(input: Partial<Record<ReturnAddressField, unknown>>):
  | { ok: true; value: ReturnAddressValues }
  | { ok: false; errors: Partial<Record<ReturnAddressField, string>> } {
  const text = (key: ReturnAddressField) => (typeof input[key] === 'string' ? (input[key] as string).trim() : '');
  const value = { name: text('name'), address: text('address'), phone: text('phone') };
  const errors: Partial<Record<ReturnAddressField, string>> = {};
  if (!value.name || value.name.length > 60 || CONTROL.test(value.name)) errors.name = '반품지 이름을 60자 이내로 입력해주세요.';
  if (!value.address || value.address.length > 500 || CONTROL.test(value.address)) errors.address = '주소를 500자 이내의 한 줄로 입력해주세요.';
  if (!PHONE.test(value.phone) || value.phone.includes('--')) errors.phone = '연락처는 숫자와 하이픈(-)으로 입력해주세요. 예: 02-1234-5678';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** RPC 오류 → 운영자 문구. 입력값은 화면에 그대로 남긴다. */
export function returnAddressErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const message = error?.message ?? '';
  if (error?.code === '42501') return '반품/교환지 변경은 최고 관리자만 할 수 있습니다.';
  if (message.includes('return_address_name_taken')) return '같은 이름의 반품지가 이미 있습니다. 다른 이름으로 저장해주세요.';
  if (message.includes('return_address_conflict')) return '다른 관리자가 이 반품지를 수정했습니다. 입력값을 복사한 뒤 새로고침해 최신 내용을 확인해주세요.';
  if (message.includes('return_address_in_use')) return '이 반품지를 고른 상품이 있어 지울 수 없습니다. 상품의 반품/교환지를 먼저 바꿔주세요.';
  if (message.includes('return_address_not_found')) return '반품지를 찾지 못했습니다. 새로고침한 뒤 다시 확인해주세요.';
  if (message.includes('invalid_return_address')) return '반품지 이름·주소·연락처를 확인해주세요.';
  return '반품지를 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.';
}

/** 주소록 읽기 결과를 좁힌다. 모양이 어긋난 줄은 버리지 않고 실패로 본다(지어낸 주소를 보이지 않는다). */
export function parseReturnAddressRows(rows: unknown, goodsCounts: ReadonlyMap<string, number> = new Map()): ReturnAddress[] | null {
  if (!Array.isArray(rows)) return null;
  const parsed: ReturnAddress[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    const record = row as Record<string, unknown>;
    if (!isUuid(record.id) || typeof record.name !== 'string' || typeof record.address !== 'string'
      || typeof record.phone !== 'string' || typeof record.updated_at !== 'string') return null;
    parsed.push({ id: record.id, name: record.name, address: record.address, phone: record.phone, updatedAt: record.updated_at,
      goodsCount: goodsCounts.get(record.id) ?? 0 });
  }
  return parsed;
}

/** 상품 편집기·미리보기가 쓰는 반품지 문장(이름 · 주소). 비운 상품은 출고지 반품 주소를 쓴다. */
export function returnAddressOptionLabel(option: ReturnAddressOption) {
  return `${option.name} · ${option.address}`;
}
