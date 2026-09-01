import Link from 'next/link';
import { EmptyState } from '@/components/wc/EmptyState';
import { MypageShell } from '@/components/wc/MypageShell';
import { coinReasonLabel, formatCoinDelta } from '@/lib/coins';
import type { CoinLedgerEntry, CoinOverview } from '@/lib/coins.server';

/*
 * 마이 코인 내역 (R-05 §4.4 · S8 #330).
 *
 * 쿠폰함과 같은 마이페이지 문법(제목 → 목록 → 하단 회색 안내 박스)을 쓰되, 코인은
 * 티켓이 아니라 원장이라 카드가 아닌 한 줄 목록이다 — 사유·시각·부호가 한 줄에서
 * 읽혀야 "왜 줄었는지"를 사용자가 스스로 대조할 수 있다.
 *
 * 용어 규율(CONTEXT.md "코인" · 코인 vs 쿠폰 vs 뽑기권): 코인은 결제 수단이 아닌
 * 무상 참여 재화다. 이 표면의 어떤 문구도 '포인트·충전·마일리지·가챠·뽑기'를 쓰지
 * 않는다 — 소진처인 뽑기권도 사용자-facing 표기인 "카드팩"으로만 부른다.
 *
 * 잔액은 coin_balances 캐시가 진실원이고 여기서 원장 합을 다시 세지 않는다.
 */

/** 원장 조회 상한. 안내 박스가 같은 수를 말하므로 라우트가 이 상수를 그대로 쓴다. */
export const COIN_LEDGER_LIMIT = 50;

/* 원장 시각은 KST 로 읽는다 — 출석의 하루 경계가 Asia/Seoul 자정이라(lib/coins.ts),
   브라우저·서버 타임존으로 그리면 자정 근처 적립이 전날로 보인다. 표기는 쿠폰함의
   점 구분 날짜(YYYY.MM.DD)에 시:분을 붙여 마이페이지 안에서 한 서식으로 읽힌다. */
const KST_DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatLedgerMoment(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = KST_DATE_TIME.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

/* attended_on 은 RPC 가 이미 KST 로 잘라 넣은 달력 날짜(YYYY-MM-DD)다. Date 로
   되파싱해 다시 타임존을 먹이면 하루가 밀 수 있으므로 구분자만 바꾼다. */
function formatAttendedOn(value: string): string {
  return value.replaceAll('-', '.');
}

function CoinLedgerRow({ entry }: { entry: CoinLedgerEntry }) {
  const earned = entry.amount >= 0;

  return (
    <li className={`wc-coin-row wc-coin-row--${earned ? 'earn' : 'spend'}`}>
      <div className="wc-coin-row__body">
        <p className="wc-coin-row__reason">{coinReasonLabel(entry.reason)}</p>
        <p className="wc-coin-row__meta">
          <time dateTime={entry.createdAt}>{formatLedgerMoment(entry.createdAt)}</time>
          {entry.attendedOn ? <span>출석일 {formatAttendedOn(entry.attendedOn)}</span> : null}
        </p>
      </div>
      {/* 부호는 formatCoinDelta 가 붙인다 — 색만으로 적립·사용을 가르지 않는다. */}
      <p className="wc-coin-row__amount">
        <strong>{formatCoinDelta(entry.amount)}</strong>개
      </p>
    </li>
  );
}

export function MyCoins({ coin, ledger }: { coin: CoinOverview | null; ledger: CoinLedgerEntry[] }) {
  /* 조회 실패·미설정은 잔액 0·미출석으로 접는다(loadCoinOverview 계약). 로그인은
     라우트가 이미 강제하므로 이 자리에 게스트 CTA 를 두지 않는다. */
  const balance = coin?.balance ?? 0;
  const attendedToday = coin?.attendedToday ?? false;

  return (
    <MypageShell active="/my/coins">
      <h1 className="wc-mypage__heading">코인</h1>
      <section aria-label="코인 잔액" className="wc-coin-strip">
        <p className="wc-coin-strip__balance">
          보유 코인 <strong>{balance.toLocaleString('ko-KR')}</strong>개
        </p>
        <p className="wc-coin-strip__attendance">
          {attendedToday ? '오늘 출석 완료' : '오늘 아직 출석하지 않았어요'}
        </p>
      </section>
      {ledger.length === 0 ? (
        <EmptyState
          action={<Link className="wc-coin-empty__link" href="/events">이벤트 보러 가기</Link>}
          className="wc-coin-empty"
          description="출석 체크와 이벤트 참여로 코인을 모을 수 있어요."
          title="아직 코인 내역이 없어요"
          titleAs="h2"
        />
      ) : (
        <ul className="wc-coin-list">
          {ledger.map((entry) => <CoinLedgerRow entry={entry} key={entry.id} />)}
        </ul>
      )}
      <div className="wc-coin-guide">
        <p>코인 안내</p>
        <ul>
          <li>코인은 출석 체크와 이벤트 참여로 모으는 무상 참여 재화예요.</li>
          <li>결제에는 쓸 수 없어요. 주문 금액 할인은 쿠폰이 맡아요.</li>
          <li>모은 코인은 이벤트에서 카드팩으로 바꿀 수 있어요.</li>
          <li>이 목록은 최근 {COIN_LEDGER_LIMIT}건까지 보여줘요.</li>
        </ul>
      </div>
    </MypageShell>
  );
}
