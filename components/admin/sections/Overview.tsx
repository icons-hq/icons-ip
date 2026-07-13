import type { AdminReportRecord } from '@/lib/admin/moderation.server';
import { Icon } from '@/components/ui/Icon';
import { MetricCard } from '../MetricCard';
import { reportTargetLabels } from './Moderation';

export function OverviewSection({
  counts,
  onOpenModeration,
  reports,
}: {
  counts: { ips: number; goods: number; cards: number; events: number; reports: number };
  onOpenModeration: () => void;
  reports: AdminReportRecord[];
}) {
  const recent = reports.slice(0, 5);

  return (
    <section className="col" style={{ gap: 16 }}>
      <div className="admin-metric-grid">
        <MetricCard icon="ip" label="IP" value={counts.ips} />
        <MetricCard icon="shop" label="굿즈" value={counts.goods} />
        <MetricCard icon="card" label="카드" value={counts.cards} />
        <MetricCard icon="event" label="이벤트" value={counts.events} />
        <MetricCard icon="shield" label="신고" value={counts.reports} />
      </div>

      <div className="card col" style={{ borderRadius: 10, padding: 18 }}>
        <div className="between" style={{ marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>최근 신고</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>커뮤니티 신고 최신 5건</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onOpenModeration} type="button">
            모두 보기 <Icon name="arrow" size={14} />
          </button>
        </div>
        {recent.map((report) => (
          <div key={report.id} className="between" style={{ borderTop: '1px solid var(--line)', gap: 12, padding: '11px 0' }}>
            <div className="col" style={{ gap: 3, minWidth: 0 }}>
              <strong style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {report.targetLabel}
              </strong>
              <span className="faint mono" style={{ fontSize: 11 }}>
                {reportTargetLabels[report.targetType]} · 신고자 @{report.reporterName} ·{' '}
                {new Date(report.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
              </span>
            </div>
            <span className="tag" style={{ color: 'var(--violet-2)' }}>{report.status}</span>
          </div>
        ))}
        {!recent.length && (
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 2px' }}>접수된 신고가 없습니다.</p>
        )}
      </div>
    </section>
  );
}
