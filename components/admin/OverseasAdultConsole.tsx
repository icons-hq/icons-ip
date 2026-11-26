'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminSectionCard } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { adminConfirm } from '@/lib/admin/confirm';
import { documentIdentity, type DocumentIdentity, type OverseasQueueItem } from '@/lib/identity/overseas-adult';

interface Review {
  id: string;
  token: string;
  url: string;
  identity: DocumentIdentity | null;
  legacyCode: string | null;
  numbers: FormDataEntryValue | null;
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
export function OverseasAdultConsole({ queue }: { queue: OverseasQueueItem[] | null }) {
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
      const res = await post(id, { action: 'open', format: 'document' }, controller.signal);
      const token = res.headers.get('x-review-token');
      const until = Date.parse(res.headers.get('x-review-until') ?? '');
      if (!res.ok || !token || !Number.isFinite(until)) throw new Error();
      const form = await res.formData();
      const photo = form.get('photo');
      const identity = documentIdentity(form.get('name'), form.get('gender'));
      const oldCode = form.get('legacyCode');
      const legacyCode = typeof oldCode === 'string' ? oldCode : null;
      const numbers = form.get('numberConsent');
      if (!(photo instanceof Blob) || (!identity && !legacyCode && numbers !== 'allow' && numbers !== 'not-present')) throw new Error();
      if (document.hidden || controller.signal.aborted || !remaining(until)) return;
      url.current = URL.createObjectURL(photo);
      setActive({ id, token, identity, legacyCode, numbers, until, url: url.current });
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
  return (
    <>
      {message && <p role="status">{message}</p>}
      {active ? (
        <AdminSectionCard title="신분증 확인">
          <div className="grid max-w-2xl gap-3" data-private>
             {active.numbers ? (
              <p>{active.numbers === 'allow'
                ? '해외 발급 신분증의 생년월일과 유효기간을 확인하세요. 사진 속 번호를 다른 곳에 옮겨 적지 마세요.'
                : '문서번호가 없는 사진으로 접수했습니다. 번호가 보이면 반려하여 파기해 주세요.'}</p>
            ) : active.identity ? (
              <p>신청인이 입력한 영문 이름 <strong>{active.identity.name}</strong> · 성별 표기 <strong>{active.identity.gender}</strong></p>
            ) : (
              <p>이전 방식으로 제출된 사진입니다. 사진의 손글씨와 <strong>{active.legacyCode}</strong>를 대조해 주세요.</p>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element -- 브라우저 메모리 안의 일회용 사진만 표시한다. */}
            <img
              alt="고객이 제출한 신분증 사본"
              src={active.url}
              className="max-h-[55vh] max-w-full object-contain"
            />
            <label>
              신분증에 적힌 생년월일
              <Input type="date" autoComplete="off" value={birth} onChange={(e) => setBirth(e.target.value)} />
            </label>
            {(active.identity || active.numbers) && <p>입력한 생년월일이 회원가입 정보와 다르면 반려됩니다.</p>}
            <label>
              <input type="checkbox" checked={matched} onChange={(e) => setMatched(e.target.checked)} />{' '}
              {active.numbers
                ? '본인 신청으로 볼 수 있는 자료인지, 해외 발급·유효기간·생년월일과 제출 동의 범위를 확인했습니다.'
                : active.identity
                ? '해외 발급·유효기간·가림 상태를 확인했고, 영문 이름과 성별 표기가 신청 정보와 일치합니다.'
                : '발급처·유효기간·얼굴·손글씨가 이전 신청 내용과 일치합니다.'}
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
      ) : queue && (
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
    </>
  );
}
