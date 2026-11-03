import { isUuid } from '@/lib/uuid';
import { parseAdminArtworkPath } from './artwork';

export const GOODS_PHOTOS_PATH = '/admin/catalog/photos';
/** DB `private.goods_photo_references`가 돌려주는 참조 종류. 새 종류가 늘어도 목록은 깨지지 않고 '기타 참조'로 보인다. */
export type GoodsPhotoReferenceKind = 'good' | 'curation' | 'store' | 'draft' | 'story' | 'relation' | 'marketing' | 'marketing_test';
export const GOODS_PHOTO_REFERENCE_LABELS: Record<GoodsPhotoReferenceKind, string> = {
  good: '상품',
  curation: '홈 전시',
  store: '스토어 전시 설정',
  draft: '상품 임시저장',
  story: '쇼핑스토리',
  relation: '연관상품',
  marketing: '고객 안내 메시지',
  marketing_test: '고객 안내 메시지 테스트 발송',
};
export const GOODS_PHOTO_OTHER_REFERENCE_LABEL = '기타 참조';
export function goodsPhotoReferenceLabel(kind: string): string {
  return Object.hasOwn(GOODS_PHOTO_REFERENCE_LABELS, kind) ? GOODS_PHOTO_REFERENCE_LABELS[kind as GoodsPhotoReferenceKind] : GOODS_PHOTO_OTHER_REFERENCE_LABEL;
}
/** kind는 알려진 값만 오지 않는다. 모르는 값은 화면에서 '기타 참조'로 표시한다. */
export interface GoodsPhotoReference { id: string; name: string; kind: string }
export interface GoodsPhoto { id: string; name: string; imagePath: string; revision: number; archived: boolean; createdAt: string; references: GoodsPhotoReference[] }
export interface GoodsPhotoPage { rows: GoodsPhoto[]; total: number; page: number; pageSize: 20 }
export interface GoodsPhotoInput { id: string; name: string; imagePath: string; revision: number; archived: boolean }
export const GOODS_PHOTO_UPLOAD_LIMIT = 10;
export const GOODS_PHOTO_NAME_MAX = 100;
export const GOODS_PHOTO_FALLBACK_NAME = '상품 이미지';
/**
 * 파일 이름을 보관함 이름으로 바꾼다. macOS는 한글 파일 이름을 NFD(자모 분리)로 넘겨 NFC 검색어와 맞지 않으므로
 * NFC로 맞추고(R20), 100자를 넘으면 자른다. 이모지 같은 서로게이트 쌍을 반으로 자르지 않는다 — DB(char_length)와
 * 화면 검사(문자열 길이) 양쪽 모두 100 이하가 되게 코드 포인트 단위로 자른다.
 */
export function goodsPhotoNameFromFileName(fileName: string): string {
  let name = '';
  for (const character of fileName.normalize('NFC').trim()) {
    if (name.length + character.length > GOODS_PHOTO_NAME_MAX) break;
    name += character;
  }
  return name.trim() || GOODS_PHOTO_FALLBACK_NAME;
}
/** 사진 이름 검색어. 저장된 이름과 같은 NFC로 비교한다(DB도 양쪽을 NFC로 맞춘다). */
export function normalizeGoodsPhotoQuery(query: string): string {
  return query.normalize('NFC').trim();
}
export function validGoodsPhotoInput(value: GoodsPhotoInput): boolean {
  if (!value || !isUuid(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 100
    || typeof value.imagePath !== 'string' || !value.imagePath.startsWith('public-media/') || !Number.isSafeInteger(value.revision)
    || value.revision < 0 || typeof value.archived !== 'boolean') return false;
  return parseAdminArtworkPath(value.imagePath.slice('public-media/'.length))?.kind === 'good';
}
export function parseGoodsPhotoPage(value: unknown): GoodsPhotoPage | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as GoodsPhotoPage;
  if (!Number.isSafeInteger(page.total) || page.total < 0 || !Number.isSafeInteger(page.page) || page.page < 1 || page.pageSize !== 20 || !Array.isArray(page.rows)) return null;
  if (page.rows.some(row => !validGoodsPhotoInput(row) || row.revision < 1 || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))
    || !Array.isArray(row.references) || row.references.some(ref => !ref || typeof ref.id !== 'string' || typeof ref.name !== 'string' || typeof ref.kind !== 'string'))) return null;
  return page;
}
export function goodsPhotoError(message: string | undefined): string {
  if (message === 'goods_photo_changed') return '다른 저장 결과가 있습니다. 목록을 새로 조회한 뒤 다시 시도해주세요. 입력은 유지됩니다.';
  if (message === 'goods_photo_in_use') return '사용 중인 사진은 보관할 수 없습니다. 연결된 상품이나 전시 설정에서 먼저 사진을 변경해주세요.';
  if (message === 'unverified_artwork') return '등록 가능한 업로드가 아닙니다. 사진을 다시 업로드해주세요.';
  return '사진을 저장하지 못했습니다. 입력을 유지합니다. 목록에서 저장 여부를 먼저 확인해주세요.';
}
