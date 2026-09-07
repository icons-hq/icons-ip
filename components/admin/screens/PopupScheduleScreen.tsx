import Link from 'next/link';
import {
  formatPopupPeriod,
  POPUP_DISPLAY_STATE_LABELS,
  POPUP_SALE_MODE_LABELS,
  POPUP_SCHEDULE_WINDOW_DAYS,
  scheduleDayTicks,
  windowSpan,
  type PopupSchedule,
} from '@/lib/popups';

/*
 * 팝업 편성 달력 (설계서 v2 §1-8).
 *
 * 팝업 하나만 보면 「이 주에 뭐가 겹치나」를 알 수 없다. 겹치는 것 자체는 막을 일이 아니지만
 * (동시에 두 팝업을 여는 것은 정상이다), **모르고 겹치는 것**은 사고다.
 */

const PHASE_TONES: Record<string, string> = {
  hidden: 'rgba(255,255,255,.10)',
  teaser: 'rgba(169,129,255,.45)',
  preorder: 'rgba(56,240,192,.35)',
  on_sale: 'rgba(56,240,192,.65)',
  sellout: 'rgba(255,216,77,.55)',
  closed: 'rgba(255,255,255,.14)',
};

export function PopupScheduleScreen({ days, schedule }: { days: number; schedule: PopupSchedule }) {
  const ticks = scheduleDayTicks(schedule.from, schedule.to);
  const nowSpan = windowSpan(schedule.serverNow, schedule.to, schedule.from, schedule.to);

  return (
    <section className="col" style={{ gap: 16, minWidth: 0 }}>
      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <span className="eyebrow">SCHEDULE</span>
          <h1 style={{ fontSize: 22, margin: '6px 0 0' }}>팝업 편성</h1>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '6px 0 0' }}>
            창에 <strong>걸치기만 해도</strong> 나옵니다 — 이번 주에 시작하는 것만 보면 이미 돌고 있는 팝업이 빠집니다.
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {POPUP_SCHEDULE_WINDOW_DAYS.map((option) => (
            <Link
              className={days === option ? 'btn btn-sm btn-holo' : 'btn btn-sm btn-ghost'}
              href={option === 14 ? '/admin/popups/schedule' : `/admin/popups/schedule?days=${option}`}
              key={option}
            >
              {option}일
            </Link>
          ))}
        </div>
      </div>

      <section className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
        <div className="admin-popup-ticks">
          {ticks.map((tick) => (
            <span className="faint" key={tick.label} style={{ left: `${tick.at * 100}%` }}>{tick.label}</span>
          ))}
        </div>

        {schedule.popups.map((popup) => {
          const span = windowSpan(popup.startsAt, popup.endsAt, schedule.from, schedule.to);
          return (
            <div className="col" key={popup.id} style={{ gap: 6 }}>
              <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <Link className="mono" href={`/admin/popups/${popup.id}`} style={{ fontSize: 12 }}>
                  {popup.title}
                </Link>
                <span className="tag">{POPUP_DISPLAY_STATE_LABELS[popup.displayState] ?? popup.displayState}</span>
                {popup.currentPhase ? <span className="tag">{popup.currentPhase}</span> : null}
                <span className="faint" style={{ fontSize: 11 }}>
                  {formatPopupPeriod(popup.startsAt, popup.endsAt)}
                </span>
              </div>
              <div className="admin-popup-track">
                {/* 지금 시각을 한 줄로 긋는다 — 「어디까지 왔나」가 달력의 첫 질문이다. */}
                {nowSpan ? <span className="admin-popup-now" style={{ left: `${nowSpan.left * 100}%` }} /> : null}
                {span ? (
                  <span className="admin-popup-bar" style={{ left: `${span.left * 100}%`, width: `${span.width * 100}%` }} />
                ) : null}
                {popup.phases.map((phase) => {
                  const phaseSpan = windowSpan(phase.startsAt, phase.endsAt, schedule.from, schedule.to);
                  if (!phaseSpan) return null;
                  return (
                    <span
                      className={phase.on ? 'admin-popup-phase on' : 'admin-popup-phase'}
                      key={phase.key}
                      style={{
                        background: PHASE_TONES[phase.defaultSaleMode] ?? PHASE_TONES.closed,
                        left: `${phaseSpan.left * 100}%`,
                        width: `${phaseSpan.width * 100}%`,
                      }}
                      title={`${phase.label} · ${POPUP_SALE_MODE_LABELS[phase.defaultSaleMode] ?? phase.defaultSaleMode}`}
                    >
                      {phaseSpan.width > 0.06 ? phase.label : ''}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}

        {schedule.popups.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>이 기간에 걸치는 팝업이 없습니다.</p>
        ) : null}
      </section>

      <p className="faint" style={{ fontSize: 11, margin: 0 }}>
        띠 색은 그 페이즈의 <strong>기본</strong> 판매 방식입니다. 연결마다 다르게 정한 규칙은 팝업 편성 화면에서 봅니다.
      </p>
    </section>
  );
}
