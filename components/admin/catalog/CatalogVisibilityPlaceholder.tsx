/*
 * 노출/숨김 자리표시.
 *
 * 보관은 하위 굿즈가 살아 있으면 막힌다(archive RPC 규칙). 그래서 "굿즈는 두고 공개
 * 화면에서만 잠시 내리는" 가벼운 숨김이 필요한데, 지금 스키마에는 그 상태가 없다.
 * 이 카드는 그 자리와 문구를 먼저 보여준다 — 동작하지 않는다는 사실을 화면이 직접
 * 말하고, 필요한 데이터 층(hidden_at + RPC)을 가리킨다.
 */
export function CatalogVisibilityPlaceholder({
  archived,
  kind,
}: {
  archived: boolean;
  kind: 'ip' | 'good';
}) {
  const label = kind === 'ip' ? 'IP' : '굿즈';
  const headingId = `catalog-visibility-${kind}`;

  return (
    <section aria-labelledby={headingId} className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
      <div>
        <span className="eyebrow">VISIBILITY · 자리표시</span>
        <h2 id={headingId} style={{ fontSize: 18, margin: '6px 0 0' }}>노출 상태</h2>
      </div>
      <div aria-label="노출 상태 (준비 중)" className="admin-visibility-toggle" role="group">
        <button
          aria-pressed={!archived}
          className={`btn btn-sm${archived ? ' btn-ghost' : ''}`}
          disabled
          type="button"
        >
          노출
        </button>
        <button aria-pressed={false} className="btn btn-sm btn-ghost" disabled type="button">
          숨김
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        숨김은 보관과 다릅니다 — 하위 굿즈와 기록을 그대로 둔 채 공개 화면에서만 {label}를 감춥니다.
        하위 굿즈가 살아 있어 보관할 수 없는 {label}를 잠시 내릴 때 씁니다.
        {' '}아직 동작하지 않습니다: 스키마(<code>hidden_at</code>)와 RPC가 필요합니다 — 설계서 데이터 층 D-1.
      </p>
    </section>
  );
}
