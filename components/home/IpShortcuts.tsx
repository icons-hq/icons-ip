import Link from 'next/link';
import type { HomeEditorPick } from '@/lib/home-catalog';

/*
 * IP 바로가기 (X SQUARE Figma Main Page · 히어로 아래 IP 썸네일 버튼 줄).
 *
 * 운영 데이터는 기존 '추천 콘텐츠'(`editor_pick`) 행이다. 필드 의미만 새 화면에 맞춘다 — 배지 = 작은 회색 줄(IP 이름),
 * 제목 = 아래 줄 문구, 이미지 = 썸네일, 링크 = IP관. 설명은 이 화면에 그리지 않는다.
 * 항목 전체가 링크 하나이고 접근 이름은 링크 안 글(IP 이름 + 문구)이다. 썸네일은 읽을 것이 없는 장식이라 접근성 트리에서 뺀다.
 * 배지·제목 사이에 공백 글자를 둔다 — 둘 다 블록 요소라 눈에는 줄이 갈리지만 이름 계산에서는 글이 붙어 읽히지 않게.
 */
export function IpShortcuts({ picks }: { picks: readonly HomeEditorPick[] }) {
  if (picks.length === 0) return null;
  return (
    <section aria-labelledby="home-ip-shortcuts-heading" className="wc-home__band wc-home__ip-shortcuts">
      <div className="wc-container wc-container--wide">
        <h2 className="wc-sr-only" id="home-ip-shortcuts-heading">IP 바로가기</h2>
        <ul className="wc-ip-shortcuts">
          {picks.map((pick) => (
            <li key={pick.id}>
              <Link className="wc-ip-shortcuts__item" href={pick.href}>
                <span aria-hidden className="wc-ip-shortcuts__thumb" style={{ background: pick.imageBg }} />
                {pick.badge ? <><span className="wc-ip-shortcuts__ip">{pick.badge}</span>{' '}</> : null}
                <span className="wc-ip-shortcuts__title">{pick.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
