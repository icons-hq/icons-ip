import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailDispatcher, type EmailDispatcherRepository, type EmailProvider } from './dispatcher';
import {
  parseStockSafetyDigestJob,
  processStockSafetyDigests,
  STOCK_SAFETY_DIGEST_CONTENT_REVISION,
  type StockSafetyDigestJob,
  type StockSafetyDigestRepository,
} from './stock-safety-digest-jobs.server';
import { renderStockSafetyDigestEmail } from './stock-safety-digest';

const item = {
  goodsCode: 'MAPLE-001', goodsName: 'TEST 아크릴 키링', optionName: '핑크빈', optionCode: 'MAPLE-001-02',
  erpCode: 'E0001', erpName: 'TEST ERP 키링', barcode: '8800000000011', stockQty: 2, threshold: 3, originName: '남양주',
};
const operatorJob: StockSafetyDigestJob = {
  id: '50000000-0000-4000-8000-000000000001', claimToken: '50000000-0000-4000-8000-000000000002', recipient: 'ops@example.test',
  audience: 'operator', originNames: [], digestDate: '2031-05-01', itemCount: 2,
  items: [item, { ...item, optionName: '기본 옵션', optionCode: 'MAPLE-002-01', goodsCode: 'MAPLE-002', erpCode: null, barcode: null, originName: '김포' }],
};
const originJob: StockSafetyDigestJob = { ...operatorJob, id: '50000000-0000-4000-8000-000000000003', recipient: 'seowon@example.test', audience: 'origin', originNames: ['남양주'], itemCount: 1, items: [item] };

function setup(jobs: StockSafetyDigestJob[] = [operatorJob]) {
  let state = 'queued';
  const finishes: unknown[] = [];
  const binds: string[] = [];
  const repository: StockSafetyDigestRepository = {
    claim: async () => jobs,
    bindIntent: async (id) => { binds.push(id); return true; },
    finish: async (_id, _claim, result) => { finishes.push(result); return true; },
  };
  const repo: EmailDispatcherRepository = {
    enqueue: vi.fn(async () => ({ kind: 'enqueued' as const, intentId: '50000000-0000-4000-8000-000000000005', idempotencyKey: 'email/digest', state: state as 'queued' })),
    enqueueAll: vi.fn(),
    claimDispatch: vi.fn(async () => ({ kind: 'claimed' as const, intentId: '50000000-0000-4000-8000-000000000005', claimId: '50000000-0000-4000-8000-000000000006', idempotencyKey: 'email/digest' })),
    recordAccepted: vi.fn(async () => { state = 'accepted'; return { state: 'accepted' as const }; }),
    recoverAcceptedPersistence: vi.fn(async () => ({ kind: 'preserved' as const, state: 'accepted' as const })),
    recordDispatchFailure: vi.fn(async () => ({ state: 'queued' as const, retryable: true })),
    reduceProviderEvent: vi.fn(),
  };
  const provider: EmailProvider = { send: vi.fn(async () => ({ kind: 'accepted' as const, providerReference: 'synthetic-provider-id' })) };
  return { repository, repo, provider, finishes, binds, dispatcher: createEmailDispatcher({ repository: repo, provider }) };
}
afterEach(() => vi.unstubAllEnvs());

describe('안전재고 요약 메일 작업', () => {
  it('고정 SITE_URL 없는 Preview는 작업 선점 전에 중단한다', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('SITE_URL', '');
    const s = setup(); s.repository.claim = vi.fn(s.repository.claim);
    await expect(processStockSafetyDigests({ repository: s.repository, dispatcher: s.dispatcher })).rejects.toThrow('email_site_url_required');
    expect(s.repository.claim).not.toHaveBeenCalled();
  });

  it('전용 출처·고정 내용으로 dispatcher에 맡기고 공급사 접수를 발송 완료로 남긴다', async () => {
    vi.stubEnv('SITE_URL', 'https://iconsip.com/');
    const s = setup([operatorJob, originJob]);
    const result = await processStockSafetyDigests({ repository: s.repository, dispatcher: s.dispatcher });
    expect(result).toMatchObject({ claimed: 2, sent: 2, failed: 0, unknown: 0, stale: 0 });
    expect(s.repo.enqueue).toHaveBeenCalledWith({ source: 'stock_safety_digest', sourceReference: operatorJob.id, recipient: 'ops@example.test',
      messageKind: 'stock_safety_digest', contentRevision: STOCK_SAFETY_DIGEST_CONTENT_REVISION });
    expect(s.binds).toEqual([operatorJob.id, originJob.id]);
    expect(s.provider.send).toHaveBeenCalledWith(expect.objectContaining({ recipient: 'seowon@example.test',
      message: expect.objectContaining({ subject: '[ICONS] 남양주 안전재고 이하 옵션 1개 (2031-05-01)' }) }));
    expect(s.finishes).toEqual([{ status: 'sent', errorCode: null, retryable: false }, { status: 'sent', errorCode: null, retryable: false }]);
  });

  it('발송 설정이 없으면 보내지 않고 다시 시도할 실패로 남긴다', async () => {
    const s = setup();
    const result = await processStockSafetyDigests({ repository: s.repository, dispatcher: null });
    expect(result).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    expect(s.finishes).toEqual([{ status: 'failed', errorCode: 'provider_not_configured', retryable: true }]);
    expect(s.provider.send).not.toHaveBeenCalled();
  });

  it('dispatcher gate가 닫혀 있으면 다시 시도할 실패다', async () => {
    const s = setup();
    s.repo.claimDispatch = vi.fn(async () => ({ kind: 'disabled' as const, state: 'queued' as const }));
    await processStockSafetyDigests({ repository: s.repository, dispatcher: createEmailDispatcher({ repository: s.repo, provider: s.provider }) });
    expect(s.finishes).toEqual([{ status: 'failed', errorCode: 'delivery_disabled', retryable: true }]);
    expect(s.provider.send).not.toHaveBeenCalled();
  });

  it('결속이 거절되면(선점 만료) 보내지 않는다', async () => {
    const s = setup();
    s.repository.bindIntent = async () => false;
    const result = await processStockSafetyDigests({ repository: s.repository, dispatcher: s.dispatcher });
    expect(result).toMatchObject({ stale: 1, sent: 0 });
    expect(s.provider.send).not.toHaveBeenCalled();
    expect(s.finishes).toEqual([]);
  });

  it('공급사 호출 중 예외는 결과 불명으로 남긴다(중복 발송 대신 검토)', async () => {
    const s = setup();
    s.provider.send = vi.fn(async () => { throw new Error('network'); });
    await processStockSafetyDigests({ repository: s.repository, dispatcher: createEmailDispatcher({ repository: s.repo, provider: s.provider }) });
    expect(s.finishes).toEqual([{ status: 'unknown', errorCode: 'delivery_outcome_unknown', retryable: false }]);
  });

  it('모양이 틀린 선점 결과는 보내지 않고 결과 불명으로 닫는다', async () => {
    const s = setup([]);
    const finish = vi.fn(async () => true);
    const repository = { ...s.repository, finish, malformed: [{ id: '50000000-0000-4000-8000-000000000009', claimToken: '50000000-0000-4000-8000-00000000000a' }] };
    const result = await processStockSafetyDigests({ repository, dispatcher: s.dispatcher });
    expect(result).toMatchObject({ claimed: 1, unknown: 1 });
    expect(finish).toHaveBeenCalledWith('50000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-00000000000a',
      { status: 'unknown', errorCode: 'delivery_needs_review', retryable: false });
    expect(s.provider.send).not.toHaveBeenCalled();
  });

  it('선점 결과의 모양을 엄격히 읽는다', () => {
    expect(parseStockSafetyDigestJob({ ...operatorJob })).toEqual(operatorJob);
    expect(parseStockSafetyDigestJob({ ...operatorJob, recipient: 'no-at-sign' })).toBeNull();
    expect(parseStockSafetyDigestJob({ ...operatorJob, items: [] })).toBeNull();
    expect(parseStockSafetyDigestJob({ ...operatorJob, items: [{ ...item, stockQty: -1 }] })).toBeNull();
    expect(parseStockSafetyDigestJob({ ...operatorJob, audience: 'customer' })).toBeNull();
    expect(parseStockSafetyDigestJob({ ...originJob })).toEqual(originJob);
    // 출고지 담당자 메일은 출고지 이름이 있어야 하고, 운영자 메일은 없어야 한다.
    expect(parseStockSafetyDigestJob({ ...originJob, originNames: [] })).toBeNull();
    expect(parseStockSafetyDigestJob({ ...operatorJob, originNames: ['남양주'] })).toBeNull();
    expect(parseStockSafetyDigestJob({ ...originJob, originNames: '남양주' })).toBeNull();
    expect(parseStockSafetyDigestJob({ ...originJob, originName: '남양주', originNames: undefined })).toBeNull();
  });
});

describe('안전재고 요약 메일 본문', () => {
  it('운영자 메일은 출고지·어드민 링크를 싣고, 창고 메일은 싣지 않는다', () => {
    const operator = renderStockSafetyDigestEmail(operatorJob, 'https://iconsip.com');
    expect(operator.subject).toBe('[ICONS] 안전재고 이하 옵션 2개 (2031-05-01)');
    expect(operator.text).toContain('- TEST 아크릴 키링 / 핑크빈 (MAPLE-001 · MAPLE-001-02 · ERP E0001 · 바코드 8800000000011) — 재고 2개 / 기준 3개 · 남양주');
    expect(operator.text).toContain('- TEST 아크릴 키링 (MAPLE-002 · MAPLE-002-01) — 재고 2개 / 기준 3개 · 김포');
    expect(operator.text).toContain('https://iconsip.com/admin/catalog/stock-reconcile');
    const origin = renderStockSafetyDigestEmail(originJob, 'https://iconsip.com');
    expect(origin.text).toContain('남양주에서 출고하는 ICONS 상품');
    expect(origin.text).not.toContain('/admin/');
    expect(origin.html).not.toContain('/admin/');
    expect(origin.html).not.toContain('<th style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top">출고지</th>');
  });

  it('여러 출고지를 맡은 주소는 한 통에 그 출고지 이름들과 출고지 열을 싣는다', () => {
    const job = { ...originJob, originNames: ['김포', '남양주'], itemCount: 2,
      items: [item, { ...item, optionName: '기본 옵션', optionCode: 'MAPLE-002-01', goodsCode: 'MAPLE-002', originName: '김포' }] };
    const email = renderStockSafetyDigestEmail(job, 'https://iconsip.com');
    expect(email.subject).toBe('[ICONS] 김포, 남양주 안전재고 이하 옵션 2개 (2031-05-01)');
    expect(email.text).toContain('김포, 남양주에서 출고하는 ICONS 상품');
    expect(email.text).toContain('재고 2개 / 기준 3개 · 김포');
    expect(email.text).toContain('재고 2개 / 기준 3개 · 남양주');
    expect(email.html).toContain('<th style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top">출고지</th>');
    expect(email.text).not.toContain('/admin/');
    // 셋 이상이면 제목에는 앞 둘과 나머지 곳 수만, 인사말에는 전부 쓴다.
    const many = renderStockSafetyDigestEmail({ ...job, originNames: ['김포', '남양주', '부천'] }, 'https://iconsip.com');
    expect(many.subject).toBe('[ICONS] 김포, 남양주 외 1곳 안전재고 이하 옵션 2개 (2031-05-01)');
    expect(many.text).toContain('김포, 남양주, 부천에서 출고하는 ICONS 상품');
  });

  it('300개를 넘는 목록은 외 N개로 끝내고 이름을 HTML로 이스케이프한다', () => {
    const job = { ...operatorJob, itemCount: 305, items: [{ ...item, goodsName: '<b>키링</b>' }] };
    const email = renderStockSafetyDigestEmail(job, 'https://iconsip.com');
    expect(email.text).toContain('외 304개 옵션은 ICONS 어드민에서 확인해주세요.');
    expect(email.html).toContain('&lt;b&gt;키링&lt;/b&gt;');
    expect(email.html).not.toContain('<b>키링</b>');
  });
});
