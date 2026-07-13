import { Icon } from '@/components/ui/Icon';

export function MetricCard({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="card admin-metric">
      <div className="between" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
        <span className="mono" style={{ color: 'var(--dim)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span className="admin-metric-icon">
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div
        className="holo-text"
        style={{ fontFamily: 'var(--ff-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.05 }}
      >
        {value}
      </div>
    </div>
  );
}
