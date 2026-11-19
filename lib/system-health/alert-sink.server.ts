import 'server-only';

/**
 * 시스템 사건(자동 작업 실패의 새 사건)을 바깥으로 알리는 단 하나의 자리.
 *
 * 여기서는 구조화된 로그 한 줄만 남긴다(Vercel 로그·로그 드레인에서 `[system-alert]`로 찾는다).
 * 운영 화면 쪽 알림은 DB가 이미 남긴다(운영 알림 '시스템' 분류, 같은 작업은 한 시간에 하나).
 * 운영 메일도 이 함수가 보내지 않는다. 서버리스 함수는 응답 뒤 끊겨 즉시 발송이 사라질 수 있으므로, 같은 DB 알림 행을
 * 운영 알림 요약 메일 cron(`/api/cron/ops-alert-digest`, 5분)이 읽어 한 통으로 보낸다(`lib/email/ops-alert-digest-jobs.server.ts`).
 * 그래서 이 함수에서 메일을 직접 보내도록 바꾸지 않는다 — 중복 메일과 끊김만 생긴다.
 * 메일 말고 다른 채널(메신저 등)을 붙일 때는 이 함수 안만 바꾼다 — 부르는 쪽(`lib/system-health/cron-run.server.ts`)은 DB가 새 사건이라고 답한
 * 실패(같은 작업의 그 시간 첫 실패)에서만 부르므로 여기서 다시 중복을 거르지 않아도 된다. 이 함수는 절대 throw하지 않아야 하고
 * (cron 응답 계약을 바꾸지 않는다), 받는 값에는 비밀·개인정보가 없다(작업 이름·상태 코드·오류 코드뿐).
 *
 * DB 안에서 도는 pg_cron 잡의 실패는 앱을 거치지 않아 여기로 오지 않는다 — 운영 알림 '시스템' 분류와 시스템 상태 화면에서 본다.
 */
export interface SystemIncident {
  readonly kind: 'cron_failure';
  readonly job: string;
  readonly label: string;
  readonly statusCode: number;
  readonly errorCode: string;
  readonly occurredAt: string;
}

export function notifySystemIncident(incident: SystemIncident): void {
  try {
    console.error('[system-alert]', {
      kind: incident.kind,
      job: incident.job,
      label: incident.label,
      statusCode: incident.statusCode,
      errorCode: incident.errorCode,
      occurredAt: incident.occurredAt,
    });
  } catch {
    // 로그 실패도 cron 응답을 바꾸지 않는다.
  }
}
