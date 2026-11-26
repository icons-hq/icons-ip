'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeOverseasAssignment } from '@/app/admin/(shell)/settings/overseas-adult/actions';
import { AdminSectionCard } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { adminConfirm } from '@/lib/admin/confirm';
import type { OverseasAssignment, OverseasManagement, OverseasQueueItem } from '@/lib/identity/overseas-adult';

interface Review {
  id: string;
  token: string;
  url: string;
  code: string;
  until: number;
}
const remaining = (until: number) => Math.max(0, until - Date.now());
const reviewUrl = (id: string) => '/api/admin/overseas-adult/' + id;
function post(id: string, body: Record<string, unknown>, signal?: AbortSignal) {
  return fetch(reviewUrl(id), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}
export function OverseasAdultConsole({
  queue,
  management,
}: {
  queue: OverseasQueueItem[] | null;
  management: OverseasManagement | null;
}) {
  const router = useRouter();
  const [active, setActive] = useState<Review | null>(null);
  const [birth, setBirth] = useState('');
  const [matched, setMatched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const url = useRef('');
  const opening = useRef<AbortController | null>(null);
  const clear = useCallback(() => {
    opening.current?.abort();
    opening.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = '';
    setActive(null);
    setBirth('');
    setMatched(false);
  }, []);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) clear();
    };
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', hide);
      clear();
    };
  }, [clear]);
  useEffect(() => {
    if (!active) return;
    const end = () => {
      clear();
      setMessage('열람을 종료했습니다. 완료하지 못한 신청은 기한이 지나면 사진을 파기합니다.');
    };
    const timeout = window.setTimeout(end, remaining(active.until));
    let stopped = false;
    const poll = window.setInterval(async () => {
      const response = await post(active.id, { action: 'check', token: active.token }).catch(() => null);
      if (!stopped && !response?.ok) end();
    }, 5000);
    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      window.clearInterval(poll);
    };
  }, [active, clear]);
  async function open(id: string) {
    if (busy || opening.current) return;
    if (
      !(await adminConfirm({
        title: '심사 사진을 열까요?',
        message: '한 번만 볼 수 있습니다. 5분 안에 처리해 주세요. 다른 탭으로 이동하면 사진이 닫힙니다.',
        confirmLabel: '사진 열기',
      }))
    )
      return;
    setBusy(true);
    setMessage('');
    const controller = new AbortController();
    opening.current = controller;
    try {
      const res = await post(id, { action: 'open' }, controller.signal);
      const token = res.headers.get('x-review-token'),
        code = res.headers.get('x-review-challenge'),
        until = Date.parse(res.headers.get('x-review-until') ?? '');
      if (!res.ok || !token || !code || !Number.isFinite(until)) throw new Error();
      const blob = await res.blob();
      if (document.hidden || controller.signal.aborted || !remaining(until)) return;
      url.current = URL.createObjectURL(blob);
      setActive({ id, token, code, until, url: url.current });
    } catch {
      setMessage('사진을 열 수 없습니다. 현재 심사 목록을 다시 확인해 주세요.');
      router.refresh();
    } finally {
      opening.current = null;
      setBusy(false);
    }
  }
  async function decide(approve: boolean) {
    if (!active || busy) return;
    if (
      !(await adminConfirm({
        title: approve ? '확인 결과를 접수할까요?' : '이 신청을 반려할까요?',
        message: '사진을 즉시 닫습니다. 파기를 확인하면 결과가 회원에게 반영됩니다.',
        confirmLabel: '결정 접수',
      }))
    )
      return;
    if (!url.current) return;
    const held = active;
    const payload = {
      action: 'decide',
      token: held.token,
      decision: approve ? 'approve' : 'reject',
      matched,
      birth: approve ? birth : null,
    };
    clear();
    setBusy(true);
    try {
      const res = await post(held.id, payload);
      setMessage(res.ok ? '결정을 접수했습니다.' : '결정이 접수되지 않았습니다. 목록을 새로고침해 주세요.');
    } catch {
      setMessage('처리 결과를 확인하려면 새로고침해 주세요.');
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  async function assign(kind: 'good' | 'reviewer', item: OverseasAssignment) {
    const text =
      kind === 'good' && !item.enabled
        ? '상품·포장·상세와 IP 계약을 검토해 회사가 자체 제한한 상품이며 해외 수동 확인을 적용할 수 있음을 확인합니다.'
        : '이 변경은 즉시 적용됩니다.';
    if (
      !(await adminConfirm({
        title: item.name + ' ' + (item.enabled ? '지정 해제' : '지정'),
        message: text,
        confirmLabel: '반영',
      }))
    )
      return;
    setBusy(true);
    try {
      const ok = await changeOverseasAssignment(kind, item.id, !item.enabled);
      setMessage(ok ? '반영했습니다.' : '권한과 담당자의 인증 앱 등록 여부를 확인해 주세요.');
      router.refresh();
    } catch {
      setMessage('설정을 저장하지 못했습니다. 새로고침해 주세요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {message && <p role="status">{message}</p>}
      {active ? (
        <AdminSectionCard title="신분증 확인">
          <div className="grid max-w-2xl gap-3" data-private>
            <p>
              신청 코드 <strong>{active.code}</strong> · 한 번 열람
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- 브라우저 메모리 안의 일회용 사진만 표시한다. */}
            <img
              alt="고객이 제출한 가린 신분증과 본인 확인 사진"
              src={active.url}
              className="max-h-[55vh] max-w-full object-contain"
            />
            <label>
              신분증에 적힌 생년월일
              <Input type="date" autoComplete="off" value={birth} onChange={(e) => setBirth(e.target.value)} />
            </label>
            <label>
              <input type="checkbox" checked={matched} onChange={(e) => setMatched(e.target.checked)} />{' '}
              발급처·문서 유효기간·얼굴·손글씨 코드 일치를 확인했습니다.
            </label>
            <div className="flex gap-2">
              <Button disabled={busy || !matched || !birth} onClick={() => void decide(true)}>
                나이 판정 후 결정
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>
                반려
              </Button>
            </div>
          </div>
        </AdminSectionCard>
      ) : (
        <>
          {queue && (
            <AdminSectionCard title="심사 대기">
              {queue.length === 0 ? (
                <p>대기 중인 신청이 없습니다.</p>
              ) : (
                <ul className="grid gap-2">
                  {queue.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        접수번호 {row.number} ·{' '}
                        {new Date(row.submittedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                      </span>
                      <Button disabled={busy} onClick={() => void open(row.id)}>
                        한 번 열람
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </AdminSectionCard>
          )}
          {management &&
            (['reviewer', 'good'] as const).map((kind) => (
              <AdminSectionCard key={kind} title={kind === 'good' ? '수동 인증 적용 상품' : '전담 심사자'}>
                <p className="mb-3">
                  {kind === 'good'
                    ? '회사 자체 제한 상품만 지정해 주세요. 법정·계약상 확인 방법이 따로 있는 상품은 제외합니다.'
                    : '인증 앱 등록을 마친 회원 관리 담당자를 지정해 주세요.'}
                </p>
                <ul className="grid gap-2">
                  {(kind === 'good' ? management.goods : management.operators).map((item) => (
                    <li className="flex items-center justify-between gap-2" key={item.id}>
                      <span>{item.name}</span>
                      <Button variant="outline" disabled={busy} onClick={() => void assign(kind, item)}>
                        {item.enabled ? '지정 해제' : '지정'}
                      </Button>
                    </li>
                  ))}
                </ul>
              </AdminSectionCard>
            ))}
        </>
      )}
    </>
  );
}
