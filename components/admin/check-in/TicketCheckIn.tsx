'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Camera, CircleAlert, CircleCheck, QrCode, TriangleAlert } from 'lucide-react';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import {
  normalizeTicketQrToken,
  parseTicketCheckInRpcResult,
  type TicketCheckInResponse,
} from '../../../lib/ticket-check-in';
import {
  classifyTicketCameraError,
  TicketCameraController,
  type TicketCameraErrorCode,
} from './ticket-camera';

type CheckInFetch = (
  input: string,
  init: { body: string; headers: { 'Content-Type': string }; method: 'POST' },
) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>;

export type TicketCheckInErrorCode =
  | 'auth_required'
  | 'cancellation_in_progress'
  | 'check_in_failed'
  | 'decode_failed'
  | 'insecure_context'
  | 'not_found'
  | TicketCameraErrorCode;

export type TicketCheckInSubmission =
  | { ok: true; value: TicketCheckInResponse }
  | { ok: false; code: Exclude<TicketCheckInErrorCode, TicketCameraErrorCode | 'decode_failed' | 'insecure_context'> };

function parseApiResponse(body: unknown): TicketCheckInResponse | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const event = typeof value.event === 'object' && value.event !== null
    ? value.event as Record<string, unknown>
    : {};
  const ticketType = typeof value.ticketType === 'object' && value.ticketType !== null
    ? value.ticketType as Record<string, unknown>
    : {};
  const parsed = parseTicketCheckInRpcResult([{
    result: value.result,
    checked_at: value.checkedAt,
    event_id: event.id,
    event_title: event.title,
    ticket_type_id: ticketType.id,
    ticket_type_name: ticketType.name,
  }]);
  return parsed && parsed.result !== 'not_found' ? parsed : null;
}

export async function submitTicketCheckIn(
  rawValue: string,
  fetcher: CheckInFetch = fetch,
): Promise<TicketCheckInSubmission> {
  const qrToken = normalizeTicketQrToken(rawValue);
  if (!qrToken) return { ok: false, code: 'not_found' };

  let response: Awaited<ReturnType<CheckInFetch>>;
  try {
    response = await fetcher('/api/admin/check-in', {
      body: JSON.stringify({ qrToken }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  } catch {
    return { ok: false, code: 'check_in_failed' };
  }

  if (!response.ok) {
    if (response.status === 401) return { ok: false, code: 'auth_required' };
    if (response.status === 404) return { ok: false, code: 'not_found' };
    if (response.status === 409) return { ok: false, code: 'cancellation_in_progress' };
    return { ok: false, code: 'check_in_failed' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: 'check_in_failed' };
  }
  const value = parseApiResponse(body);
  return value ? { ok: true, value } : { ok: false, code: 'check_in_failed' };
}

export function formatTicketCheckInTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

export function ticketCheckInPresentation(value: TicketCheckInResponse) {
  switch (value.result) {
    case 'checked_in':
      return {
        body: '입장 처리가 완료됐습니다.',
        title: '검표 완료',
        tone: 'success' as const,
      };
    case 'already_used':
      return {
        body: '이미 검표된 티켓입니다. 최초 검표 시각을 확인해주세요.',
        title: '이미 사용된 티켓',
        tone: 'warning' as const,
      };
    case 'refunded':
      return {
        body: '환불된 티켓은 입장에 사용할 수 없습니다.',
        title: '환불된 티켓',
        tone: 'danger' as const,
      };
  }
}

const ERROR_PRESENTATIONS: Record<TicketCheckInErrorCode, { body: string; title: string }> = {
  auth_required: {
    title: '로그인이 만료됐습니다',
    body: '다시 로그인한 뒤 검표를 계속해주세요.',
  },
  camera_busy: {
    title: '카메라를 열 수 없습니다',
    body: '다른 앱에서 카메라를 사용 중인지 확인한 뒤 다시 시도해주세요.',
  },
  cancellation_in_progress: {
    title: '취소 처리 중인 티켓',
    body: '취소·환불 확인 중인 티켓은 검표할 수 없습니다.',
  },
  check_in_failed: {
    title: '검표 상태를 확인하지 못했습니다',
    body: '잠시 후 QR을 다시 스캔하거나 코드를 다시 입력해주세요.',
  },
  decode_failed: {
    title: 'QR을 읽지 못했습니다',
    body: 'QR 전체가 밝은 화면 안에 들어오게 한 뒤 다시 스캔해주세요.',
  },
  insecure_context: {
    title: '카메라를 사용할 수 없는 연결입니다',
    body: 'HTTPS로 접속했는지 확인하거나 수동 입력을 사용해주세요.',
  },
  no_camera: {
    title: '사용 가능한 카메라가 없습니다',
    body: 'USB·Bluetooth 스캐너 또는 수동 입력을 사용해주세요.',
  },
  not_found: {
    title: '유효한 티켓을 찾을 수 없습니다',
    body: 'QR이 선명한지 확인하고 다시 스캔해주세요.',
  },
  permission_denied: {
    title: '카메라 권한이 거부됐습니다',
    body: '브라우저 설정에서 권한을 허용하거나 수동 입력을 사용해주세요.',
  },
  unsupported: {
    title: '이 브라우저에서는 카메라를 사용할 수 없습니다',
    body: '최신 브라우저를 사용하거나 수동 입력을 사용해주세요.',
  },
};

/* 결과 카드의 톤. 현장에서 한눈에 갈리도록 카드 전체가 의미색이다(색 + 아이콘 + 큰 글자). 의미색은 콘솔 토큰만 쓴다. */
const RESULT_TONE = {
  success: { card: 'border-success-border bg-success-soft', title: 'text-success', Icon: CircleCheck },
  warning: { card: 'border-warning-border bg-warning-soft', title: 'text-warning', Icon: TriangleAlert },
  danger: { card: 'border-danger-border bg-danger-soft', title: 'text-destructive', Icon: CircleAlert },
} as const;

/* 현장 태블릿·휴대폰에서 누르기 쉬운 큰 터치 영역(kit lg 크기를 44~48px로 키운다). */
const PANEL = 'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground sm:p-6';
const RESULT_CARD = 'flex flex-col gap-2 rounded-xl border-2 p-5 text-foreground sm:p-7';
const RESULT_TITLE = 'flex items-center gap-2 text-2xl leading-tight font-semibold sm:text-3xl';
const TOUCH_BUTTON = 'h-12 w-full text-base';
const CORNER = 'absolute size-7 border-info';

type FlowState =
  | { kind: 'idle' | 'scanning' | 'starting' | 'submitting' }
  | { kind: 'result'; value: TicketCheckInResponse }
  | { code: TicketCheckInErrorCode; kind: 'error' };

export function TicketCheckIn() {
  const [flow, setFlow] = useState<FlowState>({ kind: 'idle' });
  const [manualValue, setManualValue] = useState('');
  const cameraAttemptRef = useRef(0);
  const cameraControllerRef = useRef<TicketCameraController | null>(null);
  const cameraStartingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const requestInFlightRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  if (cameraControllerRef.current == null) {
    cameraControllerRef.current = new TicketCameraController();
  }

  useEffect(() => {
    const controller = cameraControllerRef.current;
    mountedRef.current = true;
    const stopWhenHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      cameraAttemptRef.current += 1;
      controller?.stop();
      cameraStartingRef.current = false;
      setFlow((current) => (
        current.kind === 'starting' || current.kind === 'scanning'
          ? { kind: 'idle' }
          : current
      ));
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => {
      mountedRef.current = false;
      cameraAttemptRef.current += 1;
      document.removeEventListener('visibilitychange', stopWhenHidden);
      controller?.stop();
    };
  }, []);

  async function handleToken(rawValue: string) {
    if (requestInFlightRef.current) return;
    cameraAttemptRef.current += 1;
    cameraControllerRef.current?.stop();
    cameraStartingRef.current = false;
    requestInFlightRef.current = true;
    setManualValue('');
    setFlow({ kind: 'submitting' });

    const result = await submitTicketCheckIn(rawValue);
    requestInFlightRef.current = false;
    if (!mountedRef.current) return;
    setFlow(result.ok
      ? { kind: 'result', value: result.value }
      : { code: result.code, kind: 'error' });
    inputRef.current?.focus();
  }

  async function startCamera() {
    if (cameraStartingRef.current || requestInFlightRef.current) return;
    if (!window.isSecureContext) {
      setFlow({ code: 'insecure_context', kind: 'error' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
      setFlow({ code: 'unsupported', kind: 'error' });
      return;
    }

    cameraStartingRef.current = true;
    const attempt = cameraAttemptRef.current + 1;
    cameraAttemptRef.current = attempt;
    setFlow({ kind: 'starting' });
    let decoded = false;
    try {
      const started = await cameraControllerRef.current?.start(videoRef.current, {
        onDecode: (value) => {
          if (cameraAttemptRef.current !== attempt) return;
          decoded = true;
          void handleToken(value);
        },
        onError: () => {
          if (cameraAttemptRef.current !== attempt) return;
          decoded = true;
          cameraAttemptRef.current += 1;
          cameraControllerRef.current?.stop();
          cameraStartingRef.current = false;
          if (mountedRef.current) setFlow({ code: 'decode_failed', kind: 'error' });
        },
      });
      if (
        cameraAttemptRef.current === attempt
        && mountedRef.current
        && started
        && !decoded
        && !requestInFlightRef.current
      ) {
        setFlow({ kind: 'scanning' });
      }
    } catch (error) {
      if (cameraAttemptRef.current === attempt && mountedRef.current) {
        setFlow({ code: classifyTicketCameraError(error), kind: 'error' });
      }
    } finally {
      if (cameraAttemptRef.current === attempt) cameraStartingRef.current = false;
    }
  }

  function stopCamera() {
    cameraAttemptRef.current += 1;
    cameraControllerRef.current?.stop();
    cameraStartingRef.current = false;
    setFlow({ kind: 'idle' });
    inputRef.current?.focus();
  }

  const resultPresentation = flow.kind === 'result'
    ? ticketCheckInPresentation(flow.value)
    : null;
  const errorPresentation = flow.kind === 'error'
    ? ERROR_PRESENTATIONS[flow.code]
    : null;
  const busy = flow.kind === 'starting' || flow.kind === 'submitting';

  /*
   * 셸 없는 전체 화면(현장 태블릿·휴대폰). 루트 `check-in-shell wc-admin`이 콘솔 토큰을 연다.
   * 카메라 스캔·수동 입력의 흐름과 문구는 그대로이고, 모양만 kit 부품과 유틸리티다.
   * 결과는 스캔 위치에 관계없이 바로 보이도록 입력 패널 위에 둔다(세로 태블릿·휴대폰에서는 패널이 한 화면을 넘는다).
   * 검표 진행 중에는 주변 자동 모션을 두지 않는다(DESIGN.md).
   */
  return (
    <main className="check-in-shell wc-admin min-h-svh bg-muted/40 px-4 py-6 text-foreground sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight text-foreground sm:text-3xl">현장 티켓 검표</h1>
            <p className="text-sm text-muted-foreground">QR을 스캔하거나 현장 스캐너로 코드를 입력하세요.</p>
          </div>
          <Link className={`${buttonVariants({ size: 'lg', variant: 'outline' })} h-11 w-full sm:w-auto`} data-slot="button" href="/admin">관리자 홈</Link>
        </header>

        <section aria-atomic="true" aria-live="polite" role="status">
          {flow.kind === 'submitting' ? (
            <div className={`${RESULT_CARD} border-info-border bg-info-soft`} data-check-in-result="processing">
              <h2 className={`${RESULT_TITLE} text-info`}>티켓 상태를 확인하고 있습니다</h2>
              <p className="text-sm">중복 요청 없이 서버 원장을 확인합니다.</p>
            </div>
          ) : flow.kind === 'result' && resultPresentation ? (
            <ResultCard
              onRescan={() => void startCamera()}
              presentation={resultPresentation}
              value={flow.value}
            />
          ) : flow.kind === 'error' && errorPresentation ? (
            <div className={`${RESULT_CARD} border-danger-border bg-danger-soft`} data-check-in-result="error" role="alert">
              <h2 className={`${RESULT_TITLE} text-destructive`}>
                <CircleAlert aria-hidden="true" className="size-7 shrink-0" />
                {errorPresentation.title}
              </h2>
              <p className="text-sm">{errorPresentation.body}</p>
              <Button className="mt-3 h-11 w-full text-base sm:w-auto sm:self-start" onClick={() => void startCamera()} size="lg" type="button" variant="outline">다시 스캔</Button>
            </div>
          ) : (
            /* 대기는 결과처럼 보이지 않게 작고 조용한 한 줄이다. */
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-xl border border-dashed px-4 py-3 text-muted-foreground" data-check-in-result="idle">
              <h2 className="text-sm font-medium">검표 대기 중</h2>
              <p className="text-sm">결과에는 이벤트와 티켓 종류만 표시됩니다.</p>
            </div>
          )}
        </section>

        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(18.75rem,0.85fr)]">
          <section aria-labelledby="camera-heading" className={PANEL}>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg leading-snug font-semibold text-foreground" id="camera-heading">카메라 QR 스캔</h2>
              <p className="text-sm text-muted-foreground">카메라는 버튼을 누른 뒤에만 켜지며, 인식 즉시 종료됩니다.</p>
            </div>
            <div
              className={`relative aspect-square w-full overflow-hidden rounded-lg border bg-muted sm:aspect-[4/3] ${flow.kind === 'scanning' ? 'border-info' : ''}`}
              data-scanning={flow.kind === 'scanning' || undefined}
            >
              <video aria-label="티켓 QR 카메라 화면" className="block size-full object-cover" muted playsInline ref={videoRef} />
              <div aria-hidden className="pointer-events-none absolute inset-[15%] z-[2] rounded-lg border border-background/60">
                <span className={`${CORNER} -top-px -left-px rounded-tl-lg border-t-2 border-l-2`} />
                <span className={`${CORNER} -top-px -right-px rounded-tr-lg border-t-2 border-r-2`} />
                <span className={`${CORNER} -bottom-px -left-px rounded-bl-lg border-b-2 border-l-2`} />
                <span className={`${CORNER} -right-px -bottom-px rounded-br-lg border-r-2 border-b-2`} />
              </div>
              {flow.kind !== 'scanning' && (
                <div aria-hidden className="absolute inset-0 grid place-content-center justify-items-center gap-2 bg-muted text-muted-foreground">
                  <span className="grid size-16 place-items-center rounded-lg border bg-background">
                    <QrCode className="size-7" />
                  </span>
                  <small className="text-xs">{flow.kind === 'starting' ? '카메라 준비 중' : '카메라 대기'}</small>
                </div>
              )}
            </div>
            {flow.kind === 'scanning' ? (
              <Button className={TOUCH_BUTTON} onClick={stopCamera} size="lg" type="button" variant="outline">카메라 중지</Button>
            ) : (
              <Button className={TOUCH_BUTTON} disabled={busy} onClick={() => void startCamera()} size="lg" type="button">
                <Camera aria-hidden="true" />
                {flow.kind === 'starting' ? '카메라 준비 중' : '카메라 시작'}
              </Button>
            )}
          </section>

          <section aria-labelledby="manual-heading" className={PANEL}>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg leading-snug font-semibold text-foreground" id="manual-heading">USB·Bluetooth 스캐너</h2>
              <p className="text-sm text-muted-foreground">32자 코드를 스캔하거나 붙여넣고 Enter를 누르세요.</p>
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const value = manualValue;
                setManualValue('');
                void handleToken(value);
              }}
            >
              <Label htmlFor="ticket-check-in-code">티켓 QR 코드</Label>
              <Input
                aria-describedby="ticket-check-in-help"
                autoCapitalize="none"
                autoComplete="off"
                autoFocus
                className="h-12 text-base tracking-[0.16em] md:text-base"
                disabled={flow.kind === 'submitting'}
                id="ticket-check-in-code"
                inputMode="text"
                maxLength={64}
                onChange={(event) => setManualValue(event.target.value)}
                ref={inputRef}
                spellCheck={false}
                type="password"
                value={manualValue}
              />
              <p className="text-sm text-muted-foreground" id="ticket-check-in-help">입력값은 제출 즉시 화면에서 지워지며 저장되지 않습니다.</p>
              <Button className={`${TOUCH_BUTTON} mt-2`} disabled={flow.kind === 'submitting'} size="lg" type="submit" variant="soft">
                {flow.kind === 'submitting' ? '검표 확인 중' : '검표하기'}
              </Button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

function ResultCard({
  onRescan,
  presentation,
  value,
}: {
  onRescan: () => void;
  presentation: NonNullable<ReturnType<typeof ticketCheckInPresentation>>;
  value: TicketCheckInResponse;
}) {
  const tone = RESULT_TONE[presentation.tone];
  return (
    <div className={`${RESULT_CARD} ${tone.card}`} data-check-in-result={presentation.tone}>
      <h2 className={`${RESULT_TITLE} ${tone.title}`}>
        <tone.Icon aria-hidden="true" className="size-7 shrink-0" />
        {presentation.title}
      </h2>
      <p className="text-sm">{presentation.body}</p>
      <dl className="mt-3 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        <div className="min-w-0 bg-card p-3"><dt className="text-xs text-muted-foreground">이벤트</dt><dd className="mt-1 text-sm font-semibold break-words">{value.event.title}</dd></div>
        <div className="min-w-0 bg-card p-3"><dt className="text-xs text-muted-foreground">티켓</dt><dd className="mt-1 text-sm font-semibold break-words">{value.ticketType.name}</dd></div>
        {value.checkedAt && (
          <div className="min-w-0 bg-card p-3"><dt className="text-xs text-muted-foreground">{value.result === 'already_used' ? '최초 검표' : '검표 시각'}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{formatTicketCheckInTime(value.checkedAt)}</dd></div>
        )}
      </dl>
      <Button className="mt-3 h-11 w-full text-base sm:w-auto sm:self-start" onClick={onRescan} size="lg" type="button" variant="outline">다시 스캔</Button>
    </div>
  );
}
