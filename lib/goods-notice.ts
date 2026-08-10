/*
 * 굿즈 고시정보 (전자상거래 상품정보제공고시).
 *
 * 항목을 고정 컬럼으로 두기로 한 결정(#171 · 계획 D7)의 표시·검증 진실원이다.
 * 어드민 폼, 폼 검증, 공개 상세페이지 표가 전부 이 배열에서 파생돼야
 * 항목이 한쪽에만 추가되는 어긋남이 생기지 않는다.
 *
 * 확장 지점: 지금 판매 대상은 캐릭터 굿즈 = 고시 분류 "기타재화" 하나뿐이라
 * 목록도 하나다. 분류가 늘면 이 배열을 분류별 맵으로 바꾸고 굿즈가 자기
 * 분류를 가리키게 한다. 그때 바뀌는 파일은 여기 하나다.
 */

export type GoodsNoticeKey =
  | 'maker'
  | 'origin'
  | 'material'
  | 'size'
  | 'madeOn'
  | 'asManager'
  | 'asContact';

export type GoodsNoticeInfo = Record<GoodsNoticeKey, string | null>;

export interface GoodsNoticeField {
  key: GoodsNoticeKey;
  /** 어드민 폼과 공개 표에서 함께 쓰는 라벨 */
  label: string;
  /** FormData 키 */
  formName: string;
  placeholder: string;
}

export const GOODS_NOTICE_FIELDS: readonly GoodsNoticeField[] = [
  {
    key: 'maker',
    label: '제조사 / 수입사',
    formName: 'noticeMaker',
    placeholder: '주식회사 아이콘스',
  },
  {
    key: 'origin',
    label: '원산지',
    formName: 'noticeOrigin',
    placeholder: '대한민국',
  },
  {
    key: 'material',
    label: '소재',
    formName: 'noticeMaterial',
    placeholder: '아크릴, 스테인리스',
  },
  {
    key: 'size',
    label: '크기 · 중량',
    formName: 'noticeSize',
    placeholder: '80 x 60 x 20mm · 90g',
  },
  {
    key: 'madeOn',
    label: '제조연월',
    formName: 'noticeMadeOn',
    placeholder: '2026-07',
  },
  {
    key: 'asManager',
    label: 'A/S 책임자',
    formName: 'noticeAsManager',
    placeholder: '아이콘스 고객센터',
  },
  {
    key: 'asContact',
    label: 'A/S 연락처',
    formName: 'noticeAsContact',
    placeholder: '02-000-0000',
  },
] as const;

export const EMPTY_GOODS_NOTICE: GoodsNoticeInfo = {
  maker: null,
  origin: null,
  material: null,
  size: null,
  madeOn: null,
  asManager: null,
  asContact: null,
};

function trimmed(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

/** 비어 있는 항목의 key. 저장을 막는 판단은 이 결과 하나로 한다. */
export function missingGoodsNoticeKeys(notice: GoodsNoticeInfo): GoodsNoticeKey[] {
  return GOODS_NOTICE_FIELDS
    .filter((field) => !trimmed(notice[field.key]))
    .map((field) => field.key);
}

/** 공개 표에 실을 행. 값이 없는 항목은 빈 칸을 만드는 대신 빼둔다. */
export function goodsNoticeRows(notice: GoodsNoticeInfo) {
  return GOODS_NOTICE_FIELDS
    .map((field) => ({ key: field.key, label: field.label, value: trimmed(notice[field.key]) }))
    .filter((row) => row.value.length > 0);
}
