const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertAdminCurationAction } from './curation-actions';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const CURATION_ID = '22222222-2222-4222-8222-222222222222';
const IMAGE_PATH = 'public-media/catalog/curation/33333333-3333-4333-8333-333333333333.webp';

const mocks = vi.hoisted(() => ({
  auth: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.test' },
    role: 'staff' as 'user' | 'staff' | 'admin',
    isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean; operatorAccess?: ReturnType<typeof legacyOperatorAccessFixture>;
  },
  createClient: vi.fn(),
  getCurrentAdminAuthState: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getCurrentAdminAuthState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
/* 공지 스트립 로더가 모듈 로드 시점에 unstable_cache 를 부른다 — 캐시 모듈 전체를 대체한다. */
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (loader: unknown) => loader,
  updateTag: mocks.updateTag,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));

function curationForm(entries: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('operationId', OPERATION_ID);
  formData.set('id', CURATION_ID);
  formData.set('kind', 'hero');
  formData.set('ipId', '');
  formData.set('title', '  홈 히어로  ');
  formData.set('imagePath', IMAGE_PATH);
  formData.set('linkPath', '  /ip/hwasan  ');
  formData.set('displayOrder', '2');
  formData.set('activeFrom', '2026-07-21T10:30');
  formData.set('activeTo', '');
  formData.set('enabled', 'on');
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe('admin curation action', () => {
  beforeEach(() => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.test' },
      role: 'staff',
      isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
    };
    mocks.createClient.mockReset();
    mocks.getCurrentAdminAuthState.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.updateTag.mockReset();
    mocks.rpc.mockReset();
    mocks.getCurrentAdminAuthState.mockImplementation(async () => mocks.auth);
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: CURATION_ID, error: null });
  });

  it('CAS 시각, 링크 없음, 대체텍스트를 손실 없이 RPC에 전달한다', async () => {
    const version = '2026-10-14T01:02:03.123456+09:00';
    await upsertAdminCurationAction({}, curationForm({ expectedUpdatedAt: version, title: '', linkPath: '', altEnabled: 'on', altTitle: '이미지', altContent: '설명' }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_home_curation', expect.objectContaining({ target_expected_updated_at: version,
      target_title: '', target_link_path: null, target_payload: { alt_enabled: true, alt_title: '이미지', alt_content: '설명' } }));
  });

  it.each(['curation_conflict', 'operation_conflict', 'curation_archived'])('다른 저장이 반영된 %s는 자동 재시도 대신 충돌로 알린다', async message => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    expect(await upsertAdminCurationAction({}, curationForm())).toMatchObject({ conflict: true, errors: { form: expect.any(String) } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(['home_hero_limit', 'home_free_product_limit', 'curation_kind_change_not_allowed', 'invalid_curation_product_collection', 'invalid_hero_alt', 'invalid_hero_style', 'invalid_hero_title', 'invalid_hero_subtitle', 'operator_capability_required'])('%s 거절은 확정된 실패로 처리한다', async message => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    const result = await upsertAdminCurationAction({}, curationForm());
    expect(result.errors).toBeDefined(); expect(result.uncertain).not.toBe(true);
  });

  it('passes the preserved operation UUID and only normalized target arguments to the upsert RPC', async () => {
    await expect(upsertAdminCurationAction({}, curationForm())).resolves.toEqual({
      message: '홈 큐레이션을 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_home_curation', {
      target_operation_id: OPERATION_ID,
      target_curation_id: CURATION_ID,
      target_kind: 'hero',
      target_ip_id: null,
      target_title: '홈 히어로',
      target_image_path: IMAGE_PATH,
      target_link_path: '/ip/hwasan',
      target_display_order: 2,
      target_active_from: '2026-07-21T01:30:00.000Z',
      target_active_to: null,
      target_enabled: true,
      target_slot: null,
      target_payload: null,
      target_expected_updated_at: null,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([['/'], ['/admin'], ['/admin/display/curations']]);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('notification');
  });

  /*
   * 공지 스트립은 전역 셸이 태그 캐시로 읽는다 — 경로 재검증만으로는 갱신되지 않고,
   * 서버 액션에서는 updateTag 만 stale 없이 즉시 만료시킨다 (Next 16).
   */
  it('저장에 성공하면 공지 스트립 캐시 태그를 즉시 만료시킨다', async () => {
    await upsertAdminCurationAction({}, curationForm({ kind: 'notice_strip' }));

    expect(mocks.updateTag.mock.calls).toEqual([['home-curations']]);
  });

  it('확장 kind 의 슬롯과 payload 를 RPC 인자로 함께 넘긴다', async () => {
    await expect(upsertAdminCurationAction({}, curationForm({
      kind: 'best_tab',
      imagePath: '',
      slot: 'category',
      goodIds: 'g13, g14',
    }))).resolves.toEqual({ message: '홈 큐레이션을 저장했습니다.' });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_home_curation', expect.objectContaining({
      target_kind: 'best_tab',
      target_image_path: null,
      target_slot: 'category',
      target_payload: { good_ids: ['g13', 'g14'] },
    }));
  });

  it('텍스트 공지 바의 버튼·대상 payload를 넘기고 셸 공지 캐시를 즉시 만료시킨다', async () => {
    const form = curationForm({ kind: 'notice_bar', title: '배송 일정 안내', imagePath: '', linkPath: '/events', ctaLabel: '보기', pageTypesField: '1' });
    form.append('pageTypes', 'product');
    form.append('pageTypes', 'home');
    await expect(upsertAdminCurationAction({}, form)).resolves.toEqual({ message: '홈 큐레이션을 저장했습니다.' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_home_curation', expect.objectContaining({
      target_kind: 'notice_bar', target_image_path: null, target_link_path: '/events',
      target_payload: { page_types: ['home', 'product'], cta_label: '보기' },
    }));
    expect(mocks.updateTag.mock.calls).toEqual([['home-curations']]);
  });

  it('공지 검증 거절은 결과 불명이 아니라 입력 확인 안내다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'invalid_curation_notice' } });
    const form = curationForm({ kind: 'notice_bar', title: '배송 일정 안내', imagePath: '', linkPath: '', pageTypesField: '1' });
    form.append('pageTypes', 'home');
    await expect(upsertAdminCurationAction({}, form)).resolves.toEqual({
      errors: { form: '텍스트 공지 바·띠배너의 문구, 버튼 문구와 공지를 보일 화면을 확인해주세요.' },
    });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it('rejects invalid forms before auth, client, or RPC access', async () => {
    await expect(upsertAdminCurationAction({}, curationForm({
      operationId: 'invalid',
      linkPath: 'https://attacker.example',
    }))).resolves.toEqual({
      errors: {
        operationId: '유효한 저장 요청이 아닙니다.',
        linkPath: '1~2048자의 안전한 내부 경로를 입력해주세요.',
      },
    });
    expect(mocks.getCurrentAdminAuthState).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it('redirects signed-out users and rejects non-staff users before RPC access', async () => {
    mocks.auth = { isConfigured: true, user: null, role: null, isStaff: false };
    await expect(upsertAdminCurationAction({}, curationForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );

    mocks.auth = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.test' },
      role: 'user',
      isStaff: false,
    };
    await expect(upsertAdminCurationAction({}, curationForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it.each([
    ['auth read rejection', () => mocks.getCurrentAdminAuthState.mockRejectedValue(new Error('private auth detail'))],
    ['client creation rejection', () => mocks.createClient.mockRejectedValue(new Error('private client detail'))],
    ['RPC rejection', () => mocks.rpc.mockRejectedValue(new Error('private rpc detail'))],
    ['RPC error', () => mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private db detail' } })],
  ])('returns one generic safe error for %s and does not revalidate', async (_label, arrange) => {
    arrange();

    const result = await upsertAdminCurationAction({}, curationForm());

    expect(result).toEqual(_label === 'auth read rejection' ? {
      errors: { form: '홈 큐레이션을 저장하지 못했습니다. 다시 시도해주세요.' },
    } : { errors: { form: '저장 결과를 확인하지 못했습니다. 입력한 내용을 유지한 채 같은 요청 결과를 확인해주세요.' }, uncertain: true });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});
