'use client';

import { useActionState } from 'react';
import { setAdminUserRoleAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { ADMIN_ASSIGNABLE_ROLES } from '@/lib/admin/roles';
import type { AdminProfileRecord } from '@/lib/admin/roles.server';
import { Icon } from '@/components/ui/Icon';
import { InlineNotice } from '../fields';

const emptyState: AdminCatalogActionState = {};

function UserRoleForm({ profile, isSelf }: { profile: AdminProfileRecord; isSelf: boolean }) {
  const [state, action, pending] = useActionState(setAdminUserRoleAction, emptyState);

  if (isSelf) {
    return <span className="faint mono" style={{ fontSize: 11 }}>본인 계정 — 변경 불가</span>;
  }

  return (
    <form action={action} className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
      <input name="profileId" type="hidden" value={profile.id} />
      <select
        defaultValue={profile.role}
        name="role"
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 13,
          minHeight: 36,
          outline: 'none',
          padding: '0 10px',
        }}
      >
        {ADMIN_ASSIGNABLE_ROLES.map((role) => (
          <option key={role} value={role}>{role}</option>
        ))}
      </select>
      <button className="btn btn-sm" disabled={pending} style={{ height: 36 }}>
        <Icon name="check" size={14} /> {pending ? '저장 중' : '역할 저장'}
      </button>
      <InlineNotice state={state} />
    </form>
  );
}

export function RolesSection({ profiles, adminId }: { profiles: AdminProfileRecord[]; adminId: string }) {
  return (
    <section className="col" style={{ gap: 12 }}>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        staff는 카탈로그·모더레이션을 처리하고, admin은 역할까지 관리합니다. 변경은 감사 로그에 남습니다.
      </p>
      {profiles.map((profile) => (
        <article key={profile.id} className="card between" style={{ borderRadius: 10, gap: 12, padding: 16, flexWrap: 'wrap' }}>
          <div className="col" style={{ gap: 4, minWidth: 0 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
              <strong style={{ fontSize: 15 }}>@{profile.nickname}</strong>
              <span className="tag" style={{ color: profile.role === 'user' ? 'var(--dim)' : 'var(--violet-2)' }}>{profile.role}</span>
            </div>
            <span className="faint mono" style={{ fontSize: 11 }}>
              {profile.id.slice(0, 8)} · 가입 {new Date(profile.createdAt).toLocaleDateString('ko-KR')}
            </span>
          </div>
          <UserRoleForm isSelf={profile.id === adminId} profile={profile} />
        </article>
      ))}
      {!profiles.length && (
        <div className="card" style={{ borderRadius: 10, padding: 18 }}>
          <div style={{ fontWeight: 700 }}>표시할 사용자가 없습니다.</div>
          <p className="muted" style={{ marginTop: 6 }}>가입한 사용자가 생기면 이곳에 표시됩니다.</p>
        </div>
      )}
    </section>
  );
}
