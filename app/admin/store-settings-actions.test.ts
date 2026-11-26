import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:{isConfigured:true,user:{id:'admin'},isStaff:true,role:'admin'},rpc:vi.fn(),updateTag:vi.fn(),revalidatePath:vi.fn(),uses:vi.fn(),carrierRow:vi.fn()}));
vi.mock('@/lib/auth/admin',()=>({getCurrentAdminAuthState:async()=>({ ...mocks.auth, operatorAccess: 'operatorAccess' in mocks.auth && mocks.auth.operatorAccess || legacyOperatorAccessFixture() })}));
/* `from`은 택배사를 끄는 저장이 그 택배사의 지금 상태를 읽을 때만 쓴다. */
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc,from:()=>({select:()=>({eq:()=>({maybeSingle:mocks.carrierRow})})})})}));
vi.mock('@/lib/admin/shipping-impact.server',()=>({loadCarrierOriginUses:mocks.uses}));
vi.mock('next/cache',()=>({updateTag:mocks.updateTag,revalidatePath:mocks.revalidatePath}));
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw new Error(`redirect:${path}`);},unstable_rethrow:(e:unknown)=>{if(e instanceof Error&&e.message.startsWith('redirect:'))throw e;}}));
import { saveStoreSettingsAction,saveShippingCarrierAction,saveShippingCarrierFormatAction,saveInquiryAutoRepliesAction } from './store-settings-actions';
const stamp='2026-09-08T01:00:00.000001Z';
function form(fields:Record<string,string>={}) { const data=new FormData(); for(const [k,v] of Object.entries({section:'business',updatedAt:stamp,email:'cs@example.test',phone:'02-000-0000',...fields}))data.set(k,v);return data;}
beforeEach(()=>{Reflect.deleteProperty(mocks.auth,'operatorAccess');mocks.auth.role='admin';mocks.auth.isStaff=true;mocks.auth.isConfigured=true;mocks.rpc.mockReset().mockResolvedValue({data:'2026-09-08T02:00:00.000001Z',error:null});mocks.updateTag.mockClear();mocks.revalidatePath.mockClear();
  /* 기본은 어느 택배사도 출고지가 쓰지 않고, 저장하려는 택배사는 지금 사용 중이다. */
  mocks.uses.mockReset().mockResolvedValue({});mocks.carrierRow.mockReset().mockResolvedValue({data:{is_active:true},error:null});});
describe('설정 저장 경계',()=>{
  it('staff는 화면을 읽어도 RPC 쓰기를 요청할 수 없다',async()=>{
    mocks.auth.role='staff';expect((await saveStoreSettingsAction({},form())).errors?.form).toContain('최고 관리자');
    expect((await saveShippingCarrierAction({},form())).errors?.form).toContain('최고 관리자');expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('저장은 현재 버전을 보내고 새 버전 및 공개 캐시 갱신을 반환한다',async()=>{
    const result=await saveStoreSettingsAction({},form());expect(result.updatedAt).toBe('2026-09-08T02:00:00.000001Z');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_store_settings',expect.objectContaining({expected_updated_at:stamp,target_section:'business'}));
    expect(mocks.updateTag).toHaveBeenCalledWith('store-settings');expect(result.values).toBeUndefined();
  });
  it('충돌 오류는 입력을 유지하고 내부 상세를 노출하지 않는다',async()=>{
    mocks.rpc.mockResolvedValue({error:{message:'store_settings_conflict secret_detail'}});
    const result=await saveStoreSettingsAction({},form());expect(result.errors?.form).toContain('다른 관리자');expect(result.values?.email).toBe('cs@example.test');expect(JSON.stringify(result)).not.toContain('secret_detail');expect(mocks.updateTag).not.toHaveBeenCalled();
  });
  it('불완전한 은행 계좌와 잘못된 URL은 DB 호출 전에 거부한다',async()=>{
    expect((await saveStoreSettingsAction({},form({section:'bank_transfer',bank:'은행',accountNumber:'',holder:''}))).errors?.form).toContain('모두');
    expect((await saveShippingCarrierAction({},form({code:'demo',label:'택배',trackingUrlTemplate:'javascript:alert(1)',active:'true'}))).errors?.trackingUrlTemplate).toBeDefined();expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('로그인 리다이렉트를 저장 실패 안내로 삼키지 않는다',async()=>{
    mocks.auth.isConfigured=false;await expect(saveStoreSettingsAction({},form())).rejects.toThrow('redirect:/login?next=');
  });
});

it('새 택배사 연속 등록에 이전 레코드의 버전을 재사용하지 않는다',async()=>{
  const result=await saveShippingCarrierAction({},form({code:'demo',label:'연습택배',trackingUrlTemplate:'https://carrier.example.test/{trackingNumber}',active:'true',updatedAt:''}));
  expect(result.message).toContain('저장했습니다');expect(result.updatedAt).toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_shipping_carrier',expect.objectContaining({expected_updated_at:null}));
});

it('문의 자동 안내는 다섯 유형을 함께 저장하고 앞뒤 공백만 정리한다', async () => {
  const data = form({ 'order.enabled': 'true', 'order.body': '  주문 안내\nhttps://iconsip.com/help  ' });
  const result = await saveInquiryAutoRepliesAction({}, data);
  expect(result.message).toContain('저장했습니다');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_store_settings', {
    target_section: 'inquiry_auto_replies', expected_updated_at: stamp,
    target_values: {
      order: { enabled: true, body: '주문 안내\nhttps://iconsip.com/help' },
      claim: { enabled: false, body: '' }, good: { enabled: false, body: '' },
      account: { enabled: false, body: '' }, etc: { enabled: false, body: '' },
    },
  });
});

it('켠 안내의 공백 문구와 2000자 초과 문구를 거부하며 입력을 그대로 보존한다', async () => {
  for (const body of [' \n\t ', '가'.repeat(2001)]) {
    const result = await saveInquiryAutoRepliesAction({}, form({ 'order.enabled': 'true', 'order.body': body }));
    expect(result.errors?.['order.body']).toBeDefined();
    expect(result.values?.['order.body']).toBe(body);
    expect(result.values?.['order.enabled']).toBe('true');
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});

/* TKT-019·099(사용자 결정 "아무나 가능하게"): 자동 첫 안내 탭을 여는 운영자는 매니저 권한 전환 전 호환 단계의 staff도 저장한다. */
it('호환 단계 staff도 문의 안내를 저장하고, 충돌·통신 실패에도 설정을 보존한다', async () => {
  const data = form({ 'good.enabled': 'true', 'good.body': '상품 안내' });
  Object.assign(mocks.auth, { role: 'staff', operatorAccess: legacyOperatorAccessFixture('staff') });
  expect((await saveInquiryAutoRepliesAction({}, data)).message).toContain('저장했습니다');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_store_settings', expect.objectContaining({ target_section: 'inquiry_auto_replies' }));
  /* 같은 staff라도 사업자·계좌·택배사는 지금처럼 호환 단계 admin 전용이다. */
  mocks.rpc.mockClear();
  expect((await saveStoreSettingsAction({}, form())).errors?.form).toContain('최고 관리자');
  expect((await saveShippingCarrierAction({}, form())).errors?.form).toContain('최고 관리자');
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({error:{message:'store_settings_conflict internal'}});
  expect(await saveInquiryAutoRepliesAction({}, data)).toMatchObject({values:{'good.body':'상품 안내','good.enabled':'true'},errors:{form:expect.stringContaining('다른 관리자')}});
  mocks.rpc.mockRejectedValue(new Error('network detail'));
  const result = await saveInquiryAutoRepliesAction({}, data);
  expect(result.values?.['good.body']).toBe('상품 안내');
  expect(result.errors?.form).toContain('입력값은 유지');
  expect(JSON.stringify(result)).not.toContain('network detail');
});

it('configured deputy can manage inquiry display but cannot edit business, bank or carrier policy', async () => {
  Object.assign(mocks.auth, { role: 'staff', operatorAccess: configuredOperatorAccessFixture('deputy') });
  expect((await saveStoreSettingsAction({}, form())).errors?.form).toContain('최고 관리자');
  expect((await saveStoreSettingsAction({}, form({ section: 'bank_transfer' }))).errors?.form).toContain('최고 관리자');
  expect((await saveShippingCarrierAction({}, form())).errors?.form).toContain('최고 관리자');
  expect(mocks.rpc).not.toHaveBeenCalled();
  const saved = await saveInquiryAutoRepliesAction({}, form({ 'order.enabled': 'true', 'order.body': '합성 문의 안내' }));
  expect(saved.message).toContain('저장했습니다');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_store_settings', expect.objectContaining({ target_section: 'inquiry_auto_replies' }));
});

it('스토어 관리 권한이 없는 계정은 문의 안내를 저장하지 못하고, 관리자(admin) 전용이라고 안내하지 않는다', async () => {
  Object.assign(mocks.auth, { role: 'staff', operatorAccess: configuredOperatorAccessFixture('logistics') });
  const result = await saveInquiryAutoRepliesAction({}, form({ 'order.enabled': 'true', 'order.body': '합성 문의 안내' }));
  expect(result.errors?.form).toBe('문의 자동 안내를 저장할 권한이 없습니다. 스토어 관리 권한이 있는 매니저에게 요청해주세요.');
  expect(result.errors?.form).not.toContain('최고 관리자');
  expect(result.values?.['order.body']).toBe('합성 문의 안내');
  expect(mocks.rpc).not.toHaveBeenCalled();
});

describe('택배사 운송장 형식 저장 (SHP-032)', () => {
  /* 화면은 식을 적지 않고 종류·자리 수를 보낸다. 서버가 만들어 저장하는 값은 식을 직접 적던 때와 같다. */
  const formatForm = (fields: Record<string, string> = {}) => form({ code: 'hanjin', trackingNumberKind: 'digits', trackingNumberMin: '10', trackingNumberMax: '14',
    trackingNumberSample: '1234-5678-9012-34', ...fields });
  it('최고 관리자만 저장하고, 현재 버전과 정규화한 확인용 번호를 DB로 보낸다', async () => {
    mocks.auth.role = 'staff';
    expect((await saveShippingCarrierFormatAction({}, formatForm())).errors?.form).toContain('최고 관리자');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.auth.role = 'admin';
    const result = await saveShippingCarrierFormatAction({}, formatForm());
    expect(result.message).toContain('운송장 형식을 저장했습니다');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_shipping_carrier_tracking_format', { target_code: 'hanjin', target_pattern: '^[0-9]{10,14}$',
      target_rule: '숫자 10~14자리', target_sample: '12345678901234', expected_updated_at: stamp });
    expect(mocks.updateTag).toHaveBeenCalledWith('store-settings');
  });
  it('입력 오류는 DB 전에, DB의 형식·확인용 번호·충돌 거절은 칸·폼 오류로 돌려준다', async () => {
    expect((await saveShippingCarrierFormatAction({}, formatForm({ trackingNumberSample: '123' }))).errors?.trackingNumberSample).toBeDefined();
    expect((await saveShippingCarrierFormatAction({}, formatForm({ updatedAt: '' }))).errors?.form).toContain('다시 열어');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'tracking_number_format_sample_mismatch' } });
    expect((await saveShippingCarrierFormatAction({}, formatForm())).errors?.trackingNumberSample).toContain('맞지 않습니다');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'store_settings_conflict' } });
    expect((await saveShippingCarrierFormatAction({}, formatForm())).errors?.form).toContain('다른 사람이 먼저 바꿨습니다');
  });
  it("'정하지 않음'을 고르면 형식과 안내 문구를 함께 비우고 공통 형식만 본다고 알린다", async () => {
    const result = await saveShippingCarrierFormatAction({}, formatForm({ trackingNumberKind: 'none', trackingNumberMin: '', trackingNumberMax: '', trackingNumberSample: '' }));
    expect(result.message).toContain('공통 형식');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_shipping_carrier_tracking_format', expect.objectContaining({ target_pattern: '', target_rule: '' }));
  });
  it('영문과 숫자·같은 자리 수는 그 모양의 식과 안내 문구로 저장한다', async () => {
    await saveShippingCarrierFormatAction({}, formatForm({ code: 'epost', trackingNumberKind: 'digits', trackingNumberMin: '13', trackingNumberMax: '13', trackingNumberSample: '1234567890123' }));
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_shipping_carrier_tracking_format', expect.objectContaining({ target_code: 'epost', target_pattern: '^[0-9]{13}$', target_rule: '숫자 13자리' }));
    await saveShippingCarrierFormatAction({}, formatForm({ trackingNumberKind: 'alnum', trackingNumberMin: '10', trackingNumberMax: '12', trackingNumberSample: 'ab12cd34ef' }));
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_shipping_carrier_tracking_format', expect.objectContaining({ target_pattern: '^[A-Z0-9]{10,12}$', target_rule: '영문·숫자 10~12자리', target_sample: 'AB12CD34EF' }));
  });
  it('자리 수가 틀리면 자리 수 칸의 오류로 돌려주고 입력을 그대로 남긴다 — DB는 부르지 않는다', async () => {
    const result = await saveShippingCarrierFormatAction({}, formatForm({ trackingNumberMin: '14', trackingNumberMax: '10' }));
    expect(result.errors?.trackingNumberLength).toBe('자리 수는 8~30 사이의 숫자로, 최소가 최대보다 크지 않게 적어 주세요.');
    expect(result.values).toMatchObject({ trackingNumberKind: 'digits', trackingNumberMin: '14', trackingNumberMax: '10', trackingNumberSample: '1234-5678-9012-34' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('종류가 없는 요청(낡은 화면에서 식을 직접 보낸 요청)은 형식을 지우지 않고 새로고침을 안내한다', async () => {
    const stale = form({ code: 'hanjin', trackingNumberPattern: '^[0-9]{10,14}$', trackingNumberRule: '숫자 10~14자리', trackingNumberSample: '12345678901234' });
    expect((await saveShippingCarrierFormatAction({}, stale)).errors?.form).toBe('화면 정보가 오래됐습니다. 새로고침한 뒤 다시 저장해 주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('DB가 형식을 거절하면 식 말(정규식) 없이 종류와 자리 수를 확인하라고 한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'invalid_tracking_number_format' } });
    const result = await saveShippingCarrierFormatAction({}, formatForm());
    expect(result.errors?.form).toBe('운송장 형식을 저장하지 못했습니다. 종류와 자리 수를 확인한 뒤 다시 저장해 주세요.');
    expect(result.errors?.form).not.toMatch(/정규식|\^|\$/);
  });
});

/* C-1: 새 주문을 받는 출고지가 기본 택배사로 쓰는 택배사는 끌 수 없다. 화면이 미리 막지만 직접 보낸 요청도 서버가 같은 판정으로 거절한다. */
describe('택배사 끄기 (C-1)', () => {
  const carrierForm = (fields: Record<string, string> = {}) => form({ code: 'hanjin', label: '한진택배', trackingUrlTemplate: 'https://carrier.example.test/{trackingNumber}', ...fields });
  const use = (originName: string, active: boolean) => ({ originId: originName, originName, active, usesRegionalFee: null });

  it('새 주문을 받는 출고지가 쓰면 끄는 저장을 거절하고 그 출고지 이름과 바꿀 곳을 말한다 — 저장하지 않고 사용 칸은 켠 채로 돌려준다', async () => {
    mocks.uses.mockResolvedValue({ hanjin: [use('김포', true)] });
    const result = await saveShippingCarrierAction({}, carrierForm());
    expect(result.errors?.form).toBe('김포 출고지가 이 택배사를 기본 택배사로 쓰고 있어 끌 수 없습니다. 배송정보 관리에서 그 출고지의 택배사를 먼저 바꿔 주세요.');
    expect(result.values).toMatchObject({ code: 'hanjin', label: '한진택배', active: 'true' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
  it('쓰는 출고지를 읽지 못했으면 끌 수 있다고 하지 않는다', async () => {
    mocks.uses.mockResolvedValue(null);
    const result = await saveShippingCarrierAction({}, carrierForm());
    expect(result.errors?.form).toBe('이 택배사를 기본으로 쓰는 출고지를 확인하지 못해 지금은 끌 수 없습니다. 잠시 뒤 다시 해 주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('쓰는 출고지가 없거나 사용 안 함인 출고지만 쓰면 끈다', async () => {
    expect((await saveShippingCarrierAction({}, carrierForm())).message).toBe('택배사를 저장했습니다.');
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_shipping_carrier', expect.objectContaining({ target_code: 'hanjin', target_active: false, expected_updated_at: stamp }));
    mocks.uses.mockResolvedValue({ hanjin: [use('남양주', false)] });
    expect((await saveShippingCarrierAction({}, carrierForm())).message).toBe('택배사를 저장했습니다.');
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it('이미 사용 안 함인 택배사의 이름·주소만 고치는 저장은 막지 않는다 — 쓰는 출고지도 읽지 않는다', async () => {
    mocks.carrierRow.mockResolvedValue({ data: { is_active: false }, error: null });
    mocks.uses.mockResolvedValue({ hanjin: [use('김포', true)] });
    expect((await saveShippingCarrierAction({}, carrierForm({ label: '한진택배(새 이름)' }))).message).toBe('택배사를 저장했습니다.');
    expect(mocks.uses).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_shipping_carrier', expect.objectContaining({ target_label: '한진택배(새 이름)', target_active: false }));
  });
  it('켜 둔 채 저장하거나 새로 등록하는 택배사는 쓰는 출고지를 읽지 않는다', async () => {
    mocks.uses.mockResolvedValue({ hanjin: [use('김포', true)] });
    await saveShippingCarrierAction({}, carrierForm({ active: 'true' }));
    await saveShippingCarrierAction({}, carrierForm({ code: 'newone', updatedAt: '' }));
    expect(mocks.uses).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it('권한이 없으면 출고지를 읽기 전에 거절한다', async () => {
    mocks.auth.role = 'staff';
    expect((await saveShippingCarrierAction({}, carrierForm())).errors?.form).toBe('택배사 변경은 최고 관리자만 할 수 있습니다.');
    expect(mocks.uses).not.toHaveBeenCalled();
  });
  it('다른 사람이 먼저 바꿨으면 낱말 표의 말로 알리고 입력을 남긴다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'store_settings_conflict' } });
    const result = await saveShippingCarrierAction({}, carrierForm({ active: 'true' }));
    expect(result.errors?.form).toBe('다른 사람이 먼저 바꿨습니다. 입력한 내용을 복사해 둔 뒤 새로고침해 최신 내용을 확인해 주세요.');
    expect(result.values).toMatchObject({ label: '한진택배', active: 'true' });
  });
});
