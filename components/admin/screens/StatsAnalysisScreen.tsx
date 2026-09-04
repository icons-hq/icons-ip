import Link from 'next/link';
import { krw } from '@/lib/format';
import {
  compareDelta,
  statsAnalysisHref,
  STATS_AXES,
  STATS_ANALYSIS_RANGE_DAYS,
  STATS_COMPARES,
  STATS_RANKS,
  STATS_UNITS,
  type StatsAnalysisData,
} from '@/lib/admin/stats-analysis';

/*
 * 판매 분석 (D-6).
 *
 * 세 물음을 한 화면에 둔다 — 언제(시계열) · 누가·어디서(축별) · 무엇이(상품).
 * 셋이 같은 모집단을 보기 때문에 축을 나눠도 합계가 어긋나지 않는다. 그래서 한 화면이다.
 */

function Tabs({
  current,
  data,
  entries,
  field,
  label,
}: {
  current: string;
  data: StatsAnalysisData;
  entries: readonly { value: string; label: string }[];
  field: 'unit' | 'compare' | 'axis' | 'rank';
  label: string;
}) {
  return (
    <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      <span className="faint" style={{ fontSize: 11, minWidth: 52 }}>{label}</span>
      {entries.map((entry) => (
        <Link
          className={current === entry.value ? 'btn btn-sm btn-holo' : 'btn btn-sm btn-ghost'}
          href={statsAnalysisHref(data.filters, { [field]: entry.value } as never)}
          key={entry.value}
        >
          {entry.label}
        </Link>
      ))}
    </div>
  );
}

function Bar({ ratio }: { ratio: number }) {
  return (
    <span aria-hidden className="admin-stats-bar">
      <span style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }} />
    </span>
  );
}

export function StatsAnalysisScreen({ data }: { data: StatsAnalysisData }) {
  const totals = data.rows.reduce(
    (sum, row) => ({
      gross: sum.gross + row.gross,
      refunds: sum.refunds + row.refunds,
      net: sum.net + row.net,
      orderCount: sum.orderCount + row.orderCount,
    }),
    { gross: 0, refunds: 0, net: 0, orderCount: 0 },
  );
  const delta = compareDelta(data.rows, data.compare);
  const axisMax = Math.max(1, ...data.breakdown.map((row) => row.gross));
  const productMax = Math.max(1, ...data.products.map((row) => row.revenue));

  return (
    <section className="col" style={{ gap: 16, minWidth: 0 }}>
      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <span className="eyebrow">ANALYSIS</span>
          <h1 style={{ fontSize: 22, margin: '6px 0 0' }}>판매 분석</h1>
        </div>
        {/* 캐시가 없다는 사실을 화면이 드러낸다 — 운영자는 환불 직후의 숫자를 본다. */}
        <span className="faint" style={{ fontSize: 11 }}>
          기준 {new Date(data.refreshedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      </div>

      <section className="card col" style={{ borderRadius: 10, gap: 10, padding: 18 }}>
        <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <span className="faint" style={{ fontSize: 11, minWidth: 52 }}>기간</span>
          {STATS_ANALYSIS_RANGE_DAYS.map((days) => (
            <Link
              className={data.filters.days === days ? 'btn btn-sm btn-holo' : 'btn btn-sm btn-ghost'}
              href={statsAnalysisHref(data.filters, { days })}
              key={days}
            >
              {days === 365 ? '1년' : `${days}일`}
            </Link>
          ))}
          <span className="faint" style={{ fontSize: 11, marginLeft: 12, minWidth: 24 }}>IP</span>
          <Link
            className={data.filters.ipId ? 'btn btn-sm btn-ghost' : 'btn btn-sm btn-holo'}
            href={statsAnalysisHref(data.filters, { ipId: '' })}
          >
            전체
          </Link>
          {data.ipOptions.slice(0, 6).map((ip) => (
            <Link
              className={data.filters.ipId === ip.id ? 'btn btn-sm btn-holo' : 'btn btn-sm btn-ghost'}
              href={statsAnalysisHref(data.filters, { ipId: ip.id })}
              key={ip.id}
            >
              {ip.title}
            </Link>
          ))}
        </div>
        <Tabs current={data.filters.unit} data={data} entries={STATS_UNITS} field="unit" label="단위" />
        <Tabs current={data.filters.compare} data={data} entries={STATS_COMPARES} field="compare" label="비교" />
      </section>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>언제</h2>
        <dl className="admin-order-summary">
          <div><dt>결제합계</dt><dd>{krw(totals.gross)}</dd></div>
          <div><dt>환불합계</dt><dd>{krw(totals.refunds)}</dd></div>
          <div><dt>순매출</dt><dd><strong>{krw(totals.net)}</strong></dd></div>
          <div><dt>주문수</dt><dd>{totals.orderCount.toLocaleString('ko-KR')}건</dd></div>
        </dl>
        {delta ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            비교 구간 순매출 {krw(delta.previous)}
            {delta.ratio === null
              /* 기준이 0이면 「몇 % 늘었다」가 성립하지 않는다. 지어내지 않는다. */
              ? ' · 비교 구간에 매출이 없어 증감률을 계산하지 않습니다'
              : ` · ${delta.ratio >= 0 ? '+' : ''}${(delta.ratio * 100).toFixed(1)}%`}
          </p>
        ) : null}
        <table className="admin-stats-table">
          <thead>
            <tr><th>구간</th><th>결제합계</th><th>환불합계</th><th>순매출</th><th>주문수</th></tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.bucket}>
                <td className="mono">{row.bucket}</td>
                <td>{krw(row.gross)}</td>
                <td>{row.refunds > 0 ? krw(row.refunds) : '-'}</td>
                <td><strong>{krw(row.net)}</strong></td>
                <td>{row.orderCount.toLocaleString('ko-KR')}</td>
              </tr>
            ))}
            {data.rows.length === 0 ? <tr><td colSpan={5}>이 기간에 매출이 없습니다.</td></tr> : null}
          </tbody>
        </table>
      </section>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>누가 · 어디서</h2>
        <Tabs current={data.filters.axis} data={data} entries={STATS_AXES} field="axis" label="축" />
        {data.filters.axis === 'dow' || data.filters.axis === 'hour' ? (
          <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
            요일·시간대는 <strong>주문한 때</strong>를 봅니다. 매출이 아니라 고객 행동을 보는 축이라 기준이 다릅니다.
          </p>
        ) : null}
        <table className="admin-stats-table">
          <thead><tr><th>구분</th><th>결제합계</th><th>주문수</th><th /></tr></thead>
          <tbody>
            {data.breakdown.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{krw(row.gross)}</td>
                <td>{row.orderCount.toLocaleString('ko-KR')}</td>
                <td style={{ width: '35%' }}><Bar ratio={row.gross / axisMax} /></td>
              </tr>
            ))}
            {data.breakdown.length === 0 ? <tr><td colSpan={4}>이 기간에 매출이 없습니다.</td></tr> : null}
          </tbody>
        </table>
      </section>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>무엇이</h2>
        <Tabs current={data.filters.rank} data={data} entries={STATS_RANKS} field="rank" label="기준" />
        <table className="admin-stats-table">
          <thead><tr><th>이름</th><th>수량</th><th>판매액</th><th>클레임</th><th /></tr></thead>
          <tbody>
            {data.products.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>{row.qty.toLocaleString('ko-KR')}</td>
                <td>{krw(row.revenue)}</td>
                <td>{row.claimCount > 0 ? `${row.claimCount}건` : '-'}</td>
                <td style={{ width: '30%' }}><Bar ratio={row.revenue / productMax} /></td>
              </tr>
            ))}
            {data.products.length === 0 ? <tr><td colSpan={5}>이 기간에 판매가 없습니다.</td></tr> : null}
          </tbody>
        </table>
      </section>
    </section>
  );
}
