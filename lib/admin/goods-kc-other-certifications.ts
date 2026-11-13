import {
  GOODS_OTHER_CERTIFICATION_TEXT_LIMIT, MAX_GOODS_OTHER_CERTIFICATIONS, type GoodsOtherCertificationDisclosure,
} from '@/lib/goods-kc';

/*
 * 기타 인증(SHEET-014·ADR-0036). KC 외 인증(종류·인증기관·인증번호·고객 노출 여부)을 상품마다 여러 건 기록한다.
 * 판매자 자가 신고라 검토 단계가 없고 공개 조건도 아니다. 고객 노출을 고른 항목만 상세 제품 안전정보에 보인다.
 * 규칙은 private.normalize_goods_other_certifications와 같다: 종류·인증번호 필수, 인증기관 선택, 각 100자·한 줄,
 * 같은 종류·인증번호(대소문자 무시)는 한 번만, 최대 20건.
 */
export { MAX_GOODS_OTHER_CERTIFICATIONS };
export interface GoodsOtherCertificationInput { kind: string; agency: string; number: string; visible: boolean }
export interface AdminGoodsOtherCertifications {
  revision: number | null;
  entries: GoodsOtherCertificationInput[];
  publishedAt: string | null;
  archivedAt: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}
export interface GoodsOtherCertificationsSaveInput { entries: GoodsOtherCertificationInput[]; expectedRevision: number | null }

const KEYS = ['kind', 'agency', 'number', 'visible'] as const;
/* DB의 [[:cntrl:]]와 같게 C0·DEL·C1 제어 문자를 거절한다. 길이는 DB char_length처럼 코드 포인트로 센다. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function revision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
}
function instantOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

/** 새 항목은 고객 상세에 표시하는 것으로 시작한다(입력하는 목적이 고객 고지다). */
export function emptyGoodsOtherCertification(): GoodsOtherCertificationInput {
  return { kind: '', agency: '', number: '', visible: true };
}

/** 형식·길이·제어 문자만 본다(입력 중인 빈 칸은 허용). 앞뒤 공백을 지운다. 잘못된 형식은 null. */
export function normalizeGoodsOtherCertifications(value: unknown): GoodsOtherCertificationInput[] | null {
  if (!Array.isArray(value) || value.length > MAX_GOODS_OTHER_CERTIFICATIONS) return null;
  const entries: GoodsOtherCertificationInput[] = [];
  for (const row of value) {
    if (!record(row) || Object.keys(row).length !== KEYS.length || Object.keys(row).some((key) => !(KEYS as readonly string[]).includes(key))
      || typeof row.visible !== 'boolean') return null;
    const text: Partial<Record<'kind' | 'agency' | 'number', string>> = {};
    for (const key of ['kind', 'agency', 'number'] as const) {
      const raw = row[key];
      if (typeof raw !== 'string') return null;
      const trimmed = raw.trim();
      if ([...trimmed].length > GOODS_OTHER_CERTIFICATION_TEXT_LIMIT || CONTROLS.test(trimmed)) return null;
      text[key] = trimmed;
    }
    entries.push({ kind: text.kind!, agency: text.agency!, number: text.number!, visible: row.visible });
  }
  return entries;
}

/** 저장 전 확인. 서버(goods_other_certification_incomplete·_duplicate)와 같은 규칙이다. */
export function goodsOtherCertificationProblems(entries: readonly GoodsOtherCertificationInput[]): string[] {
  const normalized = normalizeGoodsOtherCertifications(entries);
  if (!normalized) return [`기타 인증은 최대 ${MAX_GOODS_OTHER_CERTIFICATIONS}건, 각 칸 ${GOODS_OTHER_CERTIFICATION_TEXT_LIMIT}자까지 한 줄로 입력해주세요.`];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of normalized.entries()) {
    const label = `기타 인증 ${index + 1}`;
    if (!entry.kind || !entry.number) problems.push(`${label}: 인증 종류와 인증번호를 입력해주세요.`);
    const key = `${entry.kind.toLowerCase()}\u001f${entry.number.toLowerCase()}`;
    if (entry.kind && entry.number && seen.has(key)) problems.push(`${label}: 같은 인증 종류·인증번호가 이미 있습니다.`);
    seen.add(key);
  }
  return problems;
}

/** 고객 상세에 나가는 항목(노출을 고른 것만, 입력 순서). DB projection과 같은 모양이다. */
export function publicGoodsOtherCertifications(entries: readonly GoodsOtherCertificationInput[]): GoodsOtherCertificationDisclosure[] {
  return (normalizeGoodsOtherCertifications(entries) ?? []).filter((entry) => entry.visible && entry.kind && entry.number)
    .map(({ kind, agency, number }) => ({ kind, agency, number }));
}

export function parseGoodsOtherCertificationsSaveInput(value: unknown): GoodsOtherCertificationsSaveInput | null {
  if (!record(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'entries') || !Object.hasOwn(value, 'expectedRevision')
    || (value.expectedRevision !== null && !revision(value.expectedRevision))) return null;
  const entries = normalizeGoodsOtherCertifications(value.entries);
  if (!entries || goodsOtherCertificationProblems(entries).length) return null;
  return { entries, expectedRevision: value.expectedRevision as number | null };
}

export function parseAdminGoodsOtherCertifications(value: unknown): AdminGoodsOtherCertifications | null {
  if (!record(value) || (value.revision !== null && !revision(value.revision))
    || !instantOrNull(value.publishedAt) || !instantOrNull(value.archivedAt) || !instantOrNull(value.updatedAt)
    || (value.updatedByName !== null && typeof value.updatedByName !== 'string')) return null;
  const entries = normalizeGoodsOtherCertifications(value.entries);
  if (!entries || goodsOtherCertificationProblems(entries).length || (value.revision === null && entries.length)) return null;
  return { revision: value.revision as number | null, entries, publishedAt: value.publishedAt, archivedAt: value.archivedAt,
    updatedAt: value.updatedAt, updatedByName: value.updatedByName as string | null };
}

/** RPC 오류 → 화면 안내. 알 수 없는 오류는 일반 안내로 둔다. 다음 할 일은 부르는 화면이 붙인다(등록 화면·저장된 상품 패널이 다르다). */
export function goodsOtherCertificationsSaveError(message: string): string {
  if (message.includes('goods_other_certifications_changed')) return '다른 작업에서 기타 인증이 바뀌었습니다.';
  if (message.includes('goods_other_certification_incomplete')) return '기타 인증마다 인증 종류와 인증번호를 입력해주세요.';
  if (message.includes('goods_other_certification_duplicate')) return '같은 인증 종류·인증번호가 두 번 들어 있습니다. 하나만 남겨주세요.';
  if (message.includes('invalid_goods_other_certifications')) return `기타 인증은 최대 ${MAX_GOODS_OTHER_CERTIFICATIONS}건, 각 칸 ${GOODS_OTHER_CERTIFICATION_TEXT_LIMIT}자까지 한 줄로 입력해주세요.`;
  if (message.includes('catalog_item_archived')) return '보관된 상품은 복원한 뒤 기타 인증을 수정할 수 있습니다.';
  return '기타 인증을 저장하지 못했습니다. 다시 시도해주세요.';
}

export const GOODS_OTHER_CERTIFICATIONS_RELOAD_LABEL = '저장된 기타 인증 다시 불러오기';

/**
 * 저장된 상품 패널의 버전 충돌 안내. 서버 액션이 최신 저장값을 다시 읽어 함께 돌려주므로 화면은 입력을 그대로 두고 버전만 바꾼다.
 * 그래서 다시 저장하면 최신 값을 덮어쓰고, 최신 값으로 바꾸려면 다시 불러오기를 누른다 — 안내와 실제 동작이 같다.
 */
export function goodsOtherCertificationsConflictMessage(latest: AdminGoodsOtherCertifications): string {
  const kinds = latest.entries.map((entry) => entry.kind);
  const summary = kinds.length ? `${latest.entries.length}건: ${kinds.slice(0, 3).join(' · ')}${kinds.length > 3 ? ` 외 ${kinds.length - 3}건` : ''}` : '없음';
  return `다른 작업에서 기타 인증이 바뀌었습니다(최신 저장 ${summary}). 입력은 그대로 두었습니다. 이대로 다시 저장하면 최신 저장값을 덮어쓰고, 최신 저장값으로 바꾸려면 '${GOODS_OTHER_CERTIFICATIONS_RELOAD_LABEL}'를 누르세요.`;
}
