import Link from 'next/link';
import type { AdminPopupRow } from '@/lib/admin/popups.server';
import { formatPopupPeriod, POPUP_DISPLAY_STATE_LABELS } from '@/lib/popups';

/*
 * 팝업 목록 (설계서 v2 §1-8).
 *
 * 진행 중인 것이 위로 온다. 운영자가 이 화면을 여는 이유가 대개 「지금 돌고 있는 것」이라서다.
 */

const STATE_TONES: Record<string, string> = {
  live: 'var(--cyan)',
  upcoming: 'var(--faint)',
  paused: 'var(--pink)',
  ended: 'var(--faint)',
  draft: 'var(--faint)',
  archived: 'var(--faint)',
};

export function PopupListScreen({ popups }: { popups: AdminPopupRow[] }) {
  return (
    <section className="col" style={{ gap: 16, minWidth: 0 }}>
      <div>
        <span className="eyebrow">POPUPS</span>
        <h1 style={{ fontSize: 22, margin: '6px 0 0' }}>온라인 팝업</h1>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '6px 0 0' }}>
          팝업은 굿즈·기획전·이벤트·게임을 <strong>묶어 부르는 이름</strong>입니다. 원본은 각자 자리에
          그대로 있고, 팝업은 「언제 무엇을 열지」만 정합니다 — 팝업이 원본을 열 수는 없고 닫을 수만 있습니다.
        </p>
      </div>

      <div className="col" style={{ gap: 8 }}>
        {popups.map((popup) => (
          <Link
            className="card between admin-popup-row"
            href={`/admin/popups/${popup.id}`}
            key={popup.id}
            style={{ borderRadius: 10, flexWrap: 'wrap', gap: 12, padding: 14 }}
          >
            <span className="col" style={{ gap: 4, minWidth: 0 }}>
              <span className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <strong style={{ fontSize: 15 }}>{popup.title}</strong>
                <span className="tag" style={{ color: STATE_TONES[popup.displayState] ?? 'var(--faint)' }}>
                  {POPUP_DISPLAY_STATE_LABELS[popup.displayState] ?? popup.displayState}
                </span>
                {popup.currentPhase ? <span className="tag">{popup.currentPhase}</span> : null}
              </span>
              <span className="faint mono" style={{ fontSize: 11 }}>
                {popup.id} · {popup.ipTitle ?? popup.ipId} · {formatPopupPeriod(popup.startsAt, popup.endsAt)}
              </span>
            </span>
            <span className="faint mono" style={{ fontSize: 11 }}>
              페이즈 {popup.phaseCount} · 연결 {popup.linkCount}
            </span>
          </Link>
        ))}
        {popups.length === 0 ? (
          <div className="card" style={{ borderRadius: 10, padding: 18 }}>
            <strong>아직 만든 팝업이 없습니다.</strong>
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              아래에서 하나 만들고, 페이즈를 정한 뒤 게시하세요.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
