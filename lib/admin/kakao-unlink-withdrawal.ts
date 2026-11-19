/*
 * 카카오 연결 해제 탈퇴 검토 대기(runbook kakao-account-unlink.md §5, migration 20261119100000).
 *
 * 카카오로만 가입한 회원이 카카오 쪽에서 ICONS 연결을 끊으면 DB가 그 회원을 탈퇴 검토 대기로 남긴다. 처리 근거는 해제 사유로 나눈다
 * (2026-11-19 결정): 카카오계정 자체가 없어진 사유(카카오계정 탈퇴·강제 탈퇴)는 회원이 다시 로그인할 수 없어 해제 알림을 근거로 바로
 * 처리하고(`admin_process_kakao_unlink_withdrawal`), 연결만 끊은 사유는 회원에게 확인 연락을 한 뒤 회원이 쓴 1:1 문의로 기존
 * 탈퇴 처리(`admin_process_member_withdrawal`)를 한다. 어느 사유가 바로 처리되는지는 DB(`accountClosed`)가 정한다.
 */
import { transactionInstant, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';

export const KAKAO_UNLINK_QUEUE_PATH = '/admin/community/members/kakao-unlinks';

/** 카카오 계정 상태 변경 웹훅(User Unlinked)의 사유. 카카오 공식 문서의 뜻을 운영팀 말로 옮긴다. */
export const KAKAO_UNLINK_REASON_LABELS: Readonly<Record<string, string>> = {
  ACCOUNT_DELETE: '카카오계정 탈퇴',
  FORCED_ACCOUNT_DELETE: '카카오계정 강제 탈퇴(장기 휴면·카카오 고객센터)',
  UNLINK_FROM_APPS: '카카오계정 페이지에서 연결 해제',
  UNLINK_FROM_ADMIN: '카카오 관리자 처리로 연결 해제',
  INCOMPLETE_SIGN_UP: '카카오 가입 미완료로 연결 해제',
  REVOKE_ACCOUNT_SERVICE_TERMS: '카카오 통합서비스 약관 동의 철회',
  UNLINK_FROM_SERVICE: '서비스 쪽 연결 해제(서비스 탈퇴)',
};

/** DB `private.kakao_unlink_closes_account`와 같은 사유 — 카카오계정이 없어져 회원이 다시 로그인할 수 없다. 화면 설명용이고 판정은 DB가 한다. */
export const KAKAO_UNLINK_ACCOUNT_CLOSED_REASONS = ['ACCOUNT_DELETE', 'FORCED_ACCOUNT_DELETE'] as const;

export function kakaoUnlinkReasonLabel(reason: string): string {
  return Object.hasOwn(KAKAO_UNLINK_REASON_LABELS, reason) ? KAKAO_UNLINK_REASON_LABELS[reason] : `기타 사유(${reason})`;
}

/** 대기 중이거나 처리 근거가 된 카카오 연결 해제. `accountClosed`면 해제 알림으로 바로 탈퇴 처리할 수 있다. */
export interface KakaoUnlinkSummary {
  reason: string;
  eventAt: string;
  accountClosed: boolean;
}

const REASON_PATTERN = /^[A-Z_]{1,64}$/;

export function parseKakaoUnlinkSummary(value: unknown): KakaoUnlinkSummary | null {
  if (!transactionRecord(value) || typeof value.reason !== 'string' || !REASON_PATTERN.test(value.reason)
    || !transactionInstant(value.eventAt) || typeof value.accountClosed !== 'boolean') return null;
  return { reason: value.reason, eventAt: value.eventAt, accountClosed: value.accountClosed };
}

export interface KakaoUnlinkQueueEntry extends KakaoUnlinkSummary {
  userId: string;
  nickname: string;
  /** 회원 목록과 같이 가린 이메일. 전체 이메일은 고객 상세에서 본다. */
  maskedEmail: string;
  suspended: boolean;
}

/** 대기 목록(`admin_kakao_unlink_withdrawal_queue`). 한 줄이라도 모양이 다르면 null — 화면은 목록 대신 다시 불러오라고 안내한다. */
export function parseKakaoUnlinkQueue(value: unknown): KakaoUnlinkQueueEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: KakaoUnlinkQueueEntry[] = [];
  for (const row of value) {
    const summary = parseKakaoUnlinkSummary(row);
    if (!summary || !transactionRecord(row) || typeof row.userId !== 'string' || !isUuid(row.userId)
      || typeof row.nickname !== 'string' || typeof row.maskedEmail !== 'string' || typeof row.suspended !== 'boolean') return null;
    entries.push({ ...summary, userId: row.userId.toLowerCase(), nickname: row.nickname, maskedEmail: row.maskedEmail, suspended: row.suspended });
  }
  return entries;
}
