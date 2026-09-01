'use client';

import { useActionState } from 'react';
import {
  attendanceCheckInAction,
  type ParticipationActionState,
} from '@/app/events/participation-actions';
import { WcButton } from '@/components/wc/WcButton';

/* 출석 체크 패널 (R-06 §2.2 MISSION · S8 #330).
 *
 * 게스트에게는 같은 자리에 로그인 CTA 가 온다 — 버튼을 비활성으로 두면 "왜 못
 * 누르는지"가 화면에 없다(레퍼런스의 게스트 disabled 는 그 결함이다).
 *
 * 오늘 출석했는지는 서버가 판정해 내려준다. 여기서 날짜를 다시 계산하면 브라우저
 * 타임존이 KST 가 아닐 때 RPC 와 하루 경계가 어긋난다. */

const EMPTY_STATE: ParticipationActionState = {};

export interface AttendancePanelProps {
  attendedToday: boolean;
  balance: number;
  loginHref: string;
  /** 성공 후 revalidate 대상이자 로그인 복귀 경로 — 이 캠페인 상세 경로다. */
  next: string;
  signedIn: boolean;
}

export function AttendancePanel({
  attendedToday,
  balance,
  loginHref,
  next,
  signedIn,
}: AttendancePanelProps) {
  const [state, formAction, pending] = useActionState(attendanceCheckInAction, EMPTY_STATE);

  if (!signedIn) {
    return (
      <div className="wc-campaign-panel">
        <p className="wc-campaign-panel__lede">매일 출석하면 코인 1개를 드려요.</p>
        <div className="wc-campaign-panel__cta">
          <WcButton href={loginHref} variant="primary">로그인하고 출석하기</WcButton>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="wc-campaign-panel">
      <input name="next" type="hidden" value={next} />
      <p className="wc-campaign-panel__lede">매일 출석하면 코인 1개를 드려요.</p>
      <p className="wc-campaign-panel__balance">
        보유 코인 <strong>{balance.toLocaleString('ko-KR')}</strong>개
      </p>
      <div className="wc-campaign-panel__cta">
        {attendedToday ? (
          <WcButton disabled type="submit">오늘은 출석했어요</WcButton>
        ) : (
          <WcButton disabled={pending} type="submit" variant="primary">
            {pending ? '출석 확인 중' : '출석 체크하기'}
          </WcButton>
        )}
      </div>
      <p
        aria-live="polite"
        className={`wc-campaign-panel__feedback${state.status === 'error' ? ' is-error' : ''}`}
        role="status"
      >
        {state.message ?? ''}
      </p>
    </form>
  );
}
