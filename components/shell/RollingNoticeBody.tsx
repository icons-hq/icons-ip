import Link from 'next/link';

/* 롤링 띠배너의 흐르는 본문(Figma 40 · ADR-0043) — 공개 셸(ShellNotices)과 어드민 전시 미리보기(CurationPreview)가 같은 마크업을 쓴다.
   미리보기가 옛 회색 정적 마크업으로 남으면 운영자가 실제 모양을 검수할 수 없다(review-b m6). */

/* 롤링 띠배너의 사본 수. 트랙은 -50%만큼 흘러 처음으로 돌아가므로 절반(4개)이 가장 넓은 화면을 채워야 끊김이 없다 — 사본마다
   최소 폭(wc-chrome.css .wc-x-rolling__copy)이 짧은 문구에서도 그 폭을 보장한다. */
const ROLLING_COPY_COUNT = 8;

function RollingTrack({ message, cta }: { message: string; cta: { label: string } | null }) {
  return (
    <span aria-hidden className="wc-x-rolling__track">
      {Array.from({ length: ROLLING_COPY_COUNT }, (_, index) => (
        <span key={index} className="wc-x-rolling__copy">{message}{cta ? ` ${cta.label} ›` : ''}</span>
      ))}
    </span>
  );
}

/** 버튼이 있으면 흐르는 띠 전체가 그 링크다. 스크린리더는 흐르는 사본을 건너뛰고 문구 한 번 + 버튼 이름을 읽는다. */
export function RollingNoticeBody({
  message,
  cta,
  onCtaClick,
}: {
  message: string;
  cta: { label: string; href: string } | null;
  /** 링크를 눌렀을 때(공개 셸은 클릭 집계). 미리보기는 넘기지 않는다. */
  onCtaClick?: () => void;
}) {
  return (
    <p className="wc-x-rolling__body">
      {cta ? (
        <Link className="wc-x-rolling__link" href={cta.href} onClick={onCtaClick}>
          <span className="wc-sr-only">{message} {cta.label}</span>
          <RollingTrack cta={cta} message={message} />
        </Link>
      ) : (
        <span className="wc-x-rolling__static">
          <span className="wc-sr-only">{message}</span>
          <RollingTrack cta={null} message={message} />
        </span>
      )}
    </p>
  );
}
