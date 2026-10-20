'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { readMemberActivitySettingsAction, saveMemberActivitySettingsAction } from '@/app/admin/member-activity-actions';
import type { MemberActivitySettings } from '@/lib/admin/member-activity';
import { useGoodsGroupSession } from './GoodsGroupOperation';
export function MemberActivitySettingsPanel({ initial, actorId, sessionId }: { initial: MemberActivitySettings; actorId: string; sessionId: string | null }) {
  const [settings, setSettings] = useState(initial), [enabled, setEnabled] = useState(initial.enabled), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false);
  const [pending, start] = useTransition(), session = useGoodsGroupSession(actorId, sessionId), router = useRouter();
  function save() {
    if (!sessionId || !session.current() || pending || uncertain) return;
    start(async () => {
      const result = await saveMemberActivitySettingsAction(enabled, { actorId, sessionId, revision: settings.revision }, crypto.randomUUID());
      if (!session.current()) return;
      if ('settings' in result && result.settings) { setSettings(result.settings); setEnabled(result.settings.enabled); setMessage('설정을 저장했습니다.'); router.refresh(); }
      else { setUncertain(true); setMessage(result.error ?? '현재 상태를 조회해주세요.'); }
    });
  }
  function read() { start(async () => { const result = await readMemberActivitySettingsAction(); if (!session.current()) return;
    if ('settings' in result && result.settings) { setSettings(result.settings); setEnabled(result.settings.enabled); setUncertain(false); setMessage('현재 저장 상태를 조회했습니다.'); }
    else setMessage(result.error ?? '현재 상태를 조회하지 못했습니다.'); }); }
  return <details className="wc-admin-kit wc-admin-member-activity"><summary>회원 방문·영상 분석 설정 · {settings.enabled ? '수집 사용' : '수집 꺼짐'}</summary><div className="wc-admin-kit__section-body">
    <p>별도 선택 동의한 회원의 공개 화면 방문과 상품 영상 재생을 90일 동안 보관합니다. 마케팅 수신 동의를 대신하지 않습니다.</p>
    <p>미방문 조건은 선택 기간 전체에 걸쳐 동의와 수집이 유지된 회원만 포함합니다. 수집을 다시 켜면 관측 기간도 다시 시작합니다.</p>
    <label><input type="checkbox" checked={enabled} disabled={pending || uncertain || session.blocked} onChange={event => setEnabled(event.target.checked)} /> 회원 방문·영상 분석 사용</label>
    <div className="wc-admin-kit__actions"><button type="button" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || uncertain || session.blocked || enabled === settings.enabled} onClick={save}>설정 저장</button>
      <button type="button" className="wc-admin-kit__button" disabled={pending || session.blocked} onClick={read}>현재 상태 조회</button></div>
    {message ? <p role="status">{message}</p> : null}{session.blocked ? <p role="alert">로그인 상태가 바뀌었습니다. 현재 계정으로 다시 열어주세요.</p> : null}
  </div></details>;
}
