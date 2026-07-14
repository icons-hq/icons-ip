'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
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

  return (
    <main className="check-in-shell">
      <header className="check-in-header">
        <div>
          <span className="mono check-in-eyebrow">ICONS · STAFF ONLY</span>
          <h1>현장 티켓 검표</h1>
          <p>QR을 스캔하거나 현장 스캐너로 코드를 입력하세요.</p>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/admin">관리자 홈</Link>
      </header>

      <div className="check-in-grid">
        <section aria-labelledby="camera-heading" className="check-in-panel check-in-camera-panel">
          <div className="check-in-panel-heading">
            <span className="check-in-step mono">01 · CAMERA</span>
            <h2 id="camera-heading">카메라 QR 스캔</h2>
            <p>카메라는 버튼을 누른 뒤에만 켜지며, 인식 즉시 종료됩니다.</p>
          </div>
          <div className={`check-in-video-frame${flow.kind === 'scanning' ? ' is-scanning' : ''}`}>
            <video aria-label="티켓 QR 카메라 화면" muted playsInline ref={videoRef} />
            <div aria-hidden className="check-in-reticle"><span /></div>
            {flow.kind !== 'scanning' && (
              <div className="check-in-video-placeholder" aria-hidden>
                <span className="mono">QR</span>
                <small>{flow.kind === 'starting' ? '카메라 준비 중' : '카메라 대기'}</small>
              </div>
            )}
          </div>
          <div className="check-in-camera-actions">
            {flow.kind === 'scanning' ? (
              <button className="btn btn-ghost" onClick={stopCamera} type="button">카메라 중지</button>
            ) : (
              <button className="btn btn-holo" disabled={busy} onClick={() => void startCamera()} type="button">
                {flow.kind === 'starting' ? '카메라 준비 중' : '카메라 시작'}
              </button>
            )}
          </div>
        </section>

        <section aria-labelledby="manual-heading" className="check-in-panel check-in-manual-panel">
          <div className="check-in-panel-heading">
            <span className="check-in-step mono">02 · SCANNER / MANUAL</span>
            <h2 id="manual-heading">USB·Bluetooth 스캐너</h2>
            <p>32자 코드를 스캔하거나 붙여넣고 Enter를 누르세요.</p>
          </div>
          <form
            className="check-in-manual-form"
            onSubmit={(event) => {
              event.preventDefault();
              const value = manualValue;
              setManualValue('');
              void handleToken(value);
            }}
          >
            <label htmlFor="ticket-check-in-code">티켓 QR 코드</label>
            <input
              aria-describedby="ticket-check-in-help"
              autoCapitalize="none"
              autoComplete="off"
              autoFocus
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
            <p id="ticket-check-in-help">입력값은 제출 즉시 화면에서 지워지며 저장되지 않습니다.</p>
            <button className="btn btn-primary" disabled={flow.kind === 'submitting'} type="submit">
              {flow.kind === 'submitting' ? '검표 확인 중' : '검표하기'}
            </button>
          </form>
        </section>
      </div>

      <section aria-live="polite" aria-atomic="true" className="check-in-result" role="status">
        {flow.kind === 'submitting' ? (
          <div className="check-in-result-card is-processing">
            <span className="mono">VERIFYING</span>
            <h2>티켓 상태를 확인하고 있습니다</h2>
            <p>중복 요청 없이 서버 원장을 확인합니다.</p>
          </div>
        ) : flow.kind === 'result' && resultPresentation ? (
          <div className={`check-in-result-card is-${resultPresentation.tone}`}>
            <span className="mono">{flow.value.result.replace('_', ' ').toUpperCase()}</span>
            <h2>{resultPresentation.title}</h2>
            <p>{resultPresentation.body}</p>
            <dl>
              <div><dt>이벤트</dt><dd>{flow.value.event.title}</dd></div>
              <div><dt>티켓</dt><dd>{flow.value.ticketType.name}</dd></div>
              {flow.value.checkedAt && (
                <div><dt>{flow.value.result === 'already_used' ? '최초 검표' : '검표 시각'}</dt><dd>{formatTicketCheckInTime(flow.value.checkedAt)}</dd></div>
              )}
            </dl>
            <button className="btn btn-ghost" onClick={() => void startCamera()} type="button">다시 스캔</button>
          </div>
        ) : flow.kind === 'error' && errorPresentation ? (
          <div className="check-in-result-card is-danger" role="alert">
            <span className="mono">CHECK REQUIRED</span>
            <h2>{errorPresentation.title}</h2>
            <p>{errorPresentation.body}</p>
            <button className="btn btn-ghost" onClick={() => void startCamera()} type="button">다시 스캔</button>
          </div>
        ) : (
          <div className="check-in-result-card is-idle">
            <span className="mono">READY</span>
            <h2>검표 대기 중</h2>
            <p>결과에는 이벤트와 티켓 종류만 표시됩니다.</p>
          </div>
        )}
      </section>
    </main>
  );
}
