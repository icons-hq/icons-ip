import type { ReactNode } from 'react';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE } from '@/lib/shipping';
import { CatalogVisibilityPlaceholder } from './CatalogVisibilityPlaceholder';

/*
 * 탭 7 가운데 데이터 층(설계서 §7 D-1~D-3)이 아직 없는 칸의 자리표시.
 *
 * 규칙: name 이 없고 disabled 라 제출값에 섞이지 않는다. 지금 값이 있으면(코드 상수·
 * 현재 레코드) 그 값을 보여주고, 없으면 무엇이 필요한지 힌트로 말한다 — 빈 칸을 두면
 * 다음 사람이 "왜 저장이 안 되지"를 찾게 된다.
 */

const CONTROL_STYLE = {
  background: 'rgba(255,255,255,.03)',
  border: '1px dashed var(--line)',
  borderRadius: 10,
  color: 'var(--dim)',
  fontFamily: 'inherit',
  fontSize: 14,
  minHeight: 42,
  padding: '0 12px',
  width: '100%',
} as const;

export function PlaceholderField({
  hint,
  label,
  options,
  value,
}: {
  hint?: string;
  label: string;
  /** 있으면 select 로 그린다(첫 항목이 현재값). */
  options?: readonly string[];
  value: string;
}) {
  return (
    <label className="col admin-placeholder-field" style={{ gap: 7 }}>
      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>{label}</span>
      {options ? (
        <select className="admin-field-control" disabled style={CONTROL_STYLE} value={value} onChange={() => undefined}>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input className="admin-field-control" disabled readOnly style={CONTROL_STYLE} type="text" value={value} />
      )}
      {hint ? <span className="muted admin-placeholder-hint">{hint}</span> : null}
    </label>
  );
}

export function PlaceholderGroup({
  children,
  layer,
  note,
  title,
}: {
  children: ReactNode;
  /** 필요한 데이터 층. 예: `D-2 배송 정책`. */
  layer: string;
  note: string;
  title: string;
}) {
  return (
    <fieldset className="admin-placeholder-group">
      <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>
        {title} · 자리표시 ({layer})
      </legend>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 12px' }}>{note}</p>
      <div className="admin-form-grid">{children}</div>
    </fieldset>
  );
}

export function GoodBasicPlaceholders() {
  return (
    <PlaceholderGroup
      layer="개발자 스키마 · 설계서 §3-1 상품"
      note="목록·검색에 쓰는 짧은 요약과 검색어 열은 아직 없다. 지금은 상세 설명 하나가 전부다."
      title="요약 · 검색어"
    >
      <PlaceholderField hint="목록 카드 한 줄 요약(60자)" label="요약" value="" />
      <PlaceholderField hint="쉼표로 구분 · 검색 색인" label="검색어" value="" />
    </PlaceholderGroup>
  );
}

export function GoodSalesPlaceholders() {
  return (
    <PlaceholderGroup
      layer="개발자 스키마 · 설계서 §3-1 상품 · §3-2 등급/프로모션"
      note="정산과 구매 규칙은 ERP·회원 등급 객체가 있어야 붙는다. 지금은 판매가·정가·배지·운영 상태만 저장된다."
      title="공급가 · 과세 · 구매 규칙 · 할인 혜택"
    >
      <PlaceholderField hint="ERP 원가 대사용" label="공급가" value="" />
      <PlaceholderField label="과세 구분" options={['과세', '면세']} value="과세" />
      <PlaceholderField hint="비우면 제한 없음" label="1인 구매 수량" value="" />
      <PlaceholderField label="회원 한정" options={['전체', '회원만', '등급 지정']} value="전체" />
      <PlaceholderField hint="프로모션 객체 참조 표" label="할인 혜택" value="적용 중인 프로모션 없음" />
    </PlaceholderGroup>
  );
}

export function GoodStockTablePlaceholder({
  creating,
  id,
  initialStockQty,
  name,
  stockQty,
}: {
  creating: boolean;
  id: string;
  initialStockQty: string;
  name: string;
  stockQty: number | null;
}) {
  const qty = creating ? (initialStockQty.trim() || '0') : String(stockQty ?? 0);
  return (
    <fieldset className="admin-placeholder-group">
      <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>
        품목 표 · 자리표시 (D-1 옵션 마스터 · 품목 · 출고지별 재고)
      </legend>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 12px' }}>
        옵션이 없으면 품목 1행이 곧 상품이다. 옵션 마스터와 출고지별 재고가 생기면 이 표가 실제 입력 칸이 된다 — 지금은 상품 단위 재고 하나만 저장된다.
      </p>
      <div className="admin-console-grid-scroll">
        <table className="admin-console-grid-table admin-placeholder-table">
          <thead>
            <tr>
              <th scope="col">품목명</th>
              <th scope="col">자체 품목코드</th>
              <th data-align="end" scope="col">추가금액</th>
              <th scope="col">출고지</th>
              <th data-align="end" scope="col">재고</th>
              <th data-align="end" scope="col">안전재고</th>
              <th scope="col">진열/판매</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{name.trim() || '(상품명)'}</td>
              <td className="mono">{id.trim() || '(ID)'}</td>
              <td className="mono" data-align="end">₩0</td>
              <td>김포 (기본)</td>
              <td className="mono" data-align="end">{qty}개</td>
              <td className="muted" data-align="end">—</td>
              <td className="muted">노출 · 판매</td>
            </tr>
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}

export function GoodShippingPlaceholders() {
  const won = (value: number) => `₩${value.toLocaleString('ko-KR')}`;
  return (
    <PlaceholderGroup
      layer="D-2 배송 정책 · D-1 출고지"
      note={`지금은 코드 상수 하나가 전 상품에 같은 배송 정책을 적용한다(${won(FREE_SHIPPING_THRESHOLD)} 이상 무료 · 미만 ${won(SHIPPING_FEE)}). 배송 정책 객체와 출고지 마스터가 생기면 이 탭에서 상속/개별과 기본 출고지를 고른다.`}
      title="배송 · 출고"
    >
      <PlaceholderField
        hint={`기본 정책 = 조건부 무료 · ${won(FREE_SHIPPING_THRESHOLD)} 이상 무료 · 미만 ${won(SHIPPING_FEE)}`}
        label="배송 정책"
        options={['기본 상속', '개별 정책']}
        value="기본 상속"
      />
      <PlaceholderField hint="제주 · 도서산간 추가비" label="지역 추가비 템플릿" options={['기본 템플릿']} value="기본 템플릿" />
      <PlaceholderField hint="품목에서 덮어쓸 수 있다(설계서 결정 2)" label="출고지 (기본값)" options={['김포 (기본)', '남양주']} value="김포 (기본)" />
      <PlaceholderField label="배송 유형" options={['택배', '방문 수령', '배송 없음']} value="택배" />
    </PlaceholderGroup>
  );
}

export function GoodExposurePlaceholders({ archived }: { archived: boolean }) {
  return (
    <>
      <CatalogVisibilityPlaceholder archived={archived} kind="good" />
      <PlaceholderGroup
        layer="전시 관리 연결 · 개발자 스키마"
        note="큐레이션 순서는 전시 관리가 맡는다 — 여기서는 연결돼 있는지만 보여줄 자리다. SEO 열은 아직 없다."
        title="메인 큐레이션 · SEO"
      >
        <PlaceholderField hint="전시 관리 › 큐레이션에서 편성" label="메인 큐레이션 연결" value="연결 상태 표시 예정" />
        <PlaceholderField hint="비우면 굿즈 이름" label="SEO 제목" value="" />
        <PlaceholderField hint="비우면 상세 설명 앞부분" label="SEO 설명" value="" />
      </PlaceholderGroup>
    </>
  );
}
