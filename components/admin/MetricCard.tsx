import { Icon } from '@/components/ui/Icon';
import type { MetricChangeType } from './format';

const CHANGE_COLORS: Record<MetricChangeType, string> = {
  positive: 'var(--wc-success)',
  negative: 'var(--wc-danger)',
  neutral: 'var(--wc-ink-tertiary)',
};

export function MetricCard({
  change,
  changeType,
  icon,
  label,
  value,
}: {
  change: string;
  changeType: MetricChangeType;
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="card admin-metric wc-admin-kit wc-admin-kit__card">
      <div className="between" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
        <span className="mono" style={{ color: 'var(--wc-ink-tertiary)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span className="admin-metric-icon">
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 10, justifyContent: 'flex-start' }}>
        <span
          className="holo-text"
          style={{ fontFamily: 'var(--wc-font)', fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.05 }}
        >
          {value}
        </span>
        <span
          className="row"
          style={{ color: CHANGE_COLORS[changeType], fontSize: 12.5, fontWeight: 600, gap: 4, lineHeight: 1.2 }}
          title="이전 30일 대비"
        >
          {changeType !== 'neutral' && <Icon name={changeType === 'positive' ? 'trendUp' : 'trendDown'} size={13} />}
          {change}
        </span>
      </div>
    </div>
  );
}
