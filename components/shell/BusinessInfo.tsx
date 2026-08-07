import {
  BUSINESS_INFO,
  businessInfoRows,
  type BusinessInfo as BusinessInfoValues,
} from '@/lib/legal/business-info';

/* 전자상거래법상 판매자 정보 표기. 모든 공개 화면 푸터가 이 하나를 쓴다.
 * 값은 lib/legal/business-info.ts에서만 주입되고, 비어 있는 항목은 행이 사라진다. */
export function BusinessInfo({
  className,
  info = BUSINESS_INFO,
}: {
  className?: string;
  info?: BusinessInfoValues;
}) {
  const rows = businessInfoRows(info);
  if (rows.length === 0) return null;

  return (
    <dl aria-label="사업자 정보" className={className ? `business-info ${className}` : 'business-info'}>
      {rows.map((row) => (
        <div key={row.key} className="business-info__row">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
