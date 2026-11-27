'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { getMemberVerificationLimits } from '@/lib/admin/member-verification-limits.server';
import {
  isLimitRevision, isVerificationLimitKind, parseMemberVerificationLimits, VERIFICATION_LIMIT_LABELS,
  type MemberVerificationLimits, type VerificationLimitKind,
} from '@/lib/admin/member-verification-limits';
import { notePiiAccess } from '@/lib/admin/pii-access-log.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

const MEMBERS_PATH = '/admin/community/members';
const READ_ERROR = '인증 시도 횟수를 불러오지 못했습니다. 다시 조회해 주세요.';
const RESET_ERROR = '초기화 결과를 확인하지 못했습니다. 현재 횟수를 다시 조회해 주세요.';

export interface MemberLimitResult {
  snapshot: MemberVerificationLimits | null;
  message: string;
  ok: boolean;
}

export async function refreshMemberVerificationLimitsAction(profileId: string): Promise<MemberLimitResult> {
  const actor = await requireAdminActionAccess(MEMBERS_PATH, { capability: 'platform.manage' });
  if (!actor || !isUuid(profileId)) return { ok: false, snapshot: null, message: '회원 조회 권한과 선택한 회원을 확인해 주세요.' };
  const snapshot = await getMemberVerificationLimits(profileId);
  if (!snapshot) return { ok: false, snapshot: null, message: READ_ERROR };
  await notePiiAccess({ actorId: actor.user.id, action: 'view', surface: 'member.detail', path: MEMBERS_PATH, subjectKind: 'member', subjectIds: [profileId] });
  return { ok: true, snapshot, message: '현재 횟수를 다시 확인했습니다.' };
}

export async function resetMemberVerificationLimitAction(
  profileId: string, kind: VerificationLimitKind, revision: string, reason: string,
): Promise<MemberLimitResult> {
  const auth = await requireAdminActionAccess(MEMBERS_PATH, { capability: 'platform.manage', adminOnly: true });
  if (!auth) return { ok: false, snapshot: null, message: '이 회원의 인증 시도 횟수를 초기화할 권한이 없습니다.' };
  if (!isUuid(profileId) || !isVerificationLimitKind(kind) || !isLimitRevision(revision)) {
    return { ok: false, snapshot: null, message: '회원과 인증 종류를 다시 선택해 주세요.' };
  }
  const note = typeof reason === 'string' ? reason.trim() : '';
  if (Array.from(note).length < 2 || Array.from(note).length > 200) {
    return { ok: false, snapshot: null, message: '초기화 사유를 2~200자로 입력해 주세요.' };
  }
  const client = await createClient();
  const { data, error } = await client.rpc('admin_reset_member_verification_limit', {
    p_user_id: profileId, p_kind: kind, p_revision: revision, p_reason: note,
  });
  if (error) return { ok: false, snapshot: null, message: error.message === 'member_unavailable'
    ? '회원의 계정 상태를 확인해 주세요. 정지 또는 탈퇴 처리 중에는 초기화할 수 없습니다.' : RESET_ERROR };
  const snapshot = parseMemberVerificationLimits(data?.snapshot);
  if (!snapshot) return { ok: false, snapshot: null, message: RESET_ERROR };
  switch (data.outcome) {
    case 'reset':
      revalidatePath(MEMBERS_PATH);
      revalidatePath(`/admin/customers/${profileId}`);
      return { ok: true, snapshot, message: `${VERIFICATION_LIMIT_LABELS[kind]} 시도 횟수를 초기화했습니다.` };
    case 'empty':
      return { ok: true, snapshot, message: '이미 초기화됐거나 제한 시간이 지나 초기화할 횟수가 없습니다.' };
    case 'changed':
      return { ok: false, snapshot, message: '그사이 시도 기록이 바뀌었습니다. 갱신된 횟수를 확인한 뒤 다시 선택해 주세요.' };
    default:
      return { ok: false, snapshot: null, message: RESET_ERROR };
  }
}
