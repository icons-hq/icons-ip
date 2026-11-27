import { isUuid } from '@/lib/uuid';
import type { AdminConfirmRequest } from './confirm';

/*
 * 반품/교환지 주소록(S36-040). 상품이 고르는 반품/교환지이고, 상품에서 비우면 출고지 설정의 반품 주소를 쓴다.
 * 저장·삭제의 최종 판정(권한·이름 중복·낙관적 잠금·사용 중 삭제)은 DB RPC(admin_save_return_address·
 * admin_delete_return_address)가 하고, 여기서는 화면이 같은 규칙으로 먼저 걸러 입력값을 지킨다.
 *
 * 이름: '반품/교환지'는 이 주소록의 한 곳, '반품 주소'는 출고지의 기본 주소, '회수 주소'는 승인한 반품·교환에 정해진 주소다.
 */
export const RETURN_ADDRESSES_PATH = '/admin/settings/return-addresses';

/** 이 반품/교환지를 고른 상품 한 개(지울 수 없는 까닭을 보일 때 상품 수정으로 보낸다). */
export interface ReturnAddressGood { id: string; name: string; archived: boolean }

export interface ReturnAddress {
  id: string;
  name: string;
  address: string;
  phone: string;
  updatedAt: string;
  /** 이 주소를 반품지로 고른 상품 수(보관한 상품 포함). 0이 아니면 지울 수 없다. */
  goodsCount: number;
  /** 그 상품 가운데 앞의 몇 개(`RETURN_ADDRESS_GOODS_SHOWN`개까지). */
  goods: ReturnAddressGood[];
}

/** 지울 수 없는 까닭에 이름을 보이는 상품 수. 나머지는 '외 N개'로 줄인다. */
export const RETURN_ADDRESS_GOODS_SHOWN = 5;

/** 상품 편집기 선택지. 비우면 출고지 반품 주소다. */
export type ReturnAddressOption = Pick<ReturnAddress, 'id' | 'name' | 'address'>;

export const RETURN_ADDRESS_FIELD_LABELS = { name: '반품/교환지 이름', address: '주소', phone: '연락처' } as const;
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
  if (!value.name || value.name.length > 60 || CONTROL.test(value.name)) errors.name = '반품/교환지 이름을 60자 이내로 입력해 주세요.';
  if (!value.address || value.address.length > 500 || CONTROL.test(value.address)) errors.address = '주소를 500자 이내의 한 줄로 입력해 주세요.';
  if (!PHONE.test(value.phone) || value.phone.includes('--')) errors.phone = '연락처는 숫자와 하이픈(-)으로 입력해 주세요. 예: 02-1234-5678';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** 화면이 읽은 내용이 낡았을 때(번호·저장 시각이 맞지 않을 때)의 안내. */
export const RETURN_ADDRESS_STALE = '화면 정보가 오래됐습니다. 새로고침한 뒤 다시 해 주세요.';
/** 최고 관리자만 바꿀 수 있다는 안내(거절 문구와 조회 전용 화면이 같은 말을 쓴다). */
export const RETURN_ADDRESS_FORBIDDEN = '반품/교환지 변경은 최고 관리자만 할 수 있습니다.';

/** RPC 오류 → 운영자 문구. 입력값은 화면에 그대로 남긴다. 까닭을 모르는 오류는 하던 일(저장·삭제)에 맞춰 말한다. */
export function returnAddressErrorMessage(error: { code?: string; message?: string } | null | undefined, action: 'save' | 'delete' = 'save'): string {
  const message = error?.message ?? '';
  if (error?.code === '42501') return RETURN_ADDRESS_FORBIDDEN;
  if (message.includes('return_address_name_taken')) return '같은 이름의 반품/교환지가 이미 있습니다. 다른 이름으로 저장해 주세요.';
  if (message.includes('return_address_conflict')) return '다른 사람이 먼저 바꿨습니다. 입력한 내용을 복사해 둔 뒤 새로고침해 최신 내용을 확인해 주세요.';
  if (message.includes('return_address_in_use')) return '이 반품/교환지를 고른 상품이 있어 지울 수 없습니다. 그 상품의 반품/교환지를 먼저 바꿔 주세요.';
  if (message.includes('return_address_not_found')) return '반품/교환지를 찾지 못했습니다. 새로고침한 뒤 다시 확인해 주세요.';
  if (message.includes('invalid_return_address')) return '이름·주소·연락처를 확인해 주세요.';
  return action === 'delete' ? '반품/교환지를 지우지 못했습니다. 잠시 뒤 다시 해 주세요.' : '반품/교환지를 저장하지 못했습니다. 입력한 내용은 그대로 있습니다. 잠시 뒤 다시 해 주세요.';
}

/**
 * 주소를 고친 뒤 보이는 한 줄. `goodsCount`는 방금 이 반품/교환지를 고른 상품 수이고 읽지 못했으면 null이다.
 * 상품 상세의 반품·교환 안내는 상품이 고른 반품/교환지를 읽어 보여 주므로(`get_good_shipping_policy`) 저장하면 바로 바뀐다.
 */
export function returnAddressSavedMessage(goodsCount: number | null): string {
  if (goodsCount === null) return '저장했습니다. 이 반품/교환지를 고른 상품의 상세 화면에 바로 보입니다.';
  return goodsCount === 0
    ? '저장했습니다. 이 반품/교환지를 고른 상품은 아직 없습니다.'
    : `저장했습니다. 이 반품/교환지를 고른 상품 ${goodsCount.toLocaleString('ko-KR')}개의 상세 화면에 바로 보입니다.`;
}

/**
 * 화면 위의 한 줄. 반품·교환을 승인하는 때(`private.decide_order_claim` → `prepare_claim_collections`) 그 상품의 반품/교환지
 * (없으면 출고지 반품 주소)가 회수 주소로 정해진다 — 접수만 한 요청은 승인할 때의 주소를 쓰고, 승인한 건은 그대로다.
 */
export const RETURN_ADDRESS_APPROVAL_NOTE = '고친 주소는 앞으로 승인하는 반품·교환부터 쓰입니다. 이미 승인한 건의 회수 주소는 바뀌지 않습니다.';

/** 삭제 확인창. 상품이 고른 반품/교환지는 지울 수 없어(DB가 거절) 이 확인창은 고른 상품이 없을 때만 뜬다. */
export function returnAddressDeleteConfirm(name: string): AdminConfirmRequest {
  return {
    title: `‘${name}’ 반품/교환지를 삭제할까요?`,
    message: '삭제하면 되돌릴 수 없습니다. 이 반품/교환지를 고른 상품은 없고, 이미 승인한 반품·교환의 회수 주소는 그대로 남습니다. 삭제 기록은 감사 기록에 남습니다.',
    confirmLabel: '삭제', cancelLabel: '돌아가기', destructive: true,
  };
}

/** 상품 수정 화면. 반품/교환지를 먼저 바꿔야 할 상품으로 보낸다. */
export const returnAddressGoodHref = (goodId: string) => `/admin/catalog/goods?goodId=${encodeURIComponent(goodId)}`;

/** 주소록 읽기 결과를 좁힌다. 모양이 어긋난 줄은 버리지 않고 실패로 본다(지어낸 주소를 보이지 않는다). */
export function parseReturnAddressRows(
  rows: unknown, goodsCounts: ReadonlyMap<string, number> = new Map(), goodsByAddress: ReadonlyMap<string, ReturnAddressGood[]> = new Map(),
): ReturnAddress[] | null {
  if (!Array.isArray(rows)) return null;
  const parsed: ReturnAddress[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    const record = row as Record<string, unknown>;
    if (!isUuid(record.id) || typeof record.name !== 'string' || typeof record.address !== 'string'
      || typeof record.phone !== 'string' || typeof record.updated_at !== 'string') return null;
    parsed.push({ id: record.id, name: record.name, address: record.address, phone: record.phone, updatedAt: record.updated_at,
      goodsCount: goodsCounts.get(record.id) ?? 0, goods: goodsByAddress.get(record.id) ?? [] });
  }
  return parsed;
}

/** 상품 편집기·미리보기가 쓰는 반품지 문장(이름 · 주소). 비운 상품은 출고지 반품 주소를 쓴다. */
export function returnAddressOptionLabel(option: ReturnAddressOption) {
  return `${option.name} · ${option.address}`;
}
