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
      <div className="admin-metric__heading">
        <span className="admin-metric__label">
          {label}
        </span>
        <span className="admin-metric-icon">
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="admin-metric__reading">
        <span className="admin-metric__value">
          {value}
        </span>
        <span
          className="admin-metric__change"
          style={{ color: CHANGE_COLORS[changeType] }}
          title="이전 30일 대비"
        >
          {changeType !== 'neutral' && <Icon name={changeType === 'positive' ? 'trendUp' : 'trendDown'} size={13} />}
          {change}
        </span>
      </div>
    </div>
  );
}
