import { describe, expect, it } from 'vitest';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { parseTrackingImport, TRACKING_IMPORT_SAMPLE } from './tracking-import';

const CARRIERS: ShippingCarrierRegistry = [
  {
    code: 'hanjin',
    label: '한진택배',
    active: true,
    trackingUrlTemplate: 'https://example.test/track?no={trackingNumber}',
  },
  {
    code: 'retired_courier',
    label: '계약종료 택배',
    active: false,
    trackingUrlTemplate: 'https://example.test/old?no={trackingNumber}',
  },
];

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

describe('parseTrackingImport', () => {
  it('헤더가 있는 CSV를 읽고 운송장을 정규화한다', () => {
    const result = parseTrackingImport(
      ['주문번호,택배사코드,운송장번호', '1a2b3c4d,hanjin,1234-5678-9012'].join('\n'),
      CARRIERS,
    );

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([{
      line: 2,
      reference: '1A2B3C4D',
      orderId: null,
      carrier: 'hanjin',
      trackingNumber: '123456789012',
    }]);
  });

  /* 엑셀에서 세 칸을 복사해 붙여넣으면 탭 구분 텍스트가 된다. 헤더를 지우고
     붙여넣는 것이 오히려 흔한 경로라 헤더 없이도 읽혀야 한다. */
  it('헤더 없는 탭 구분 붙여넣기도 그대로 읽는다', () => {
    const result = parseTrackingImport('1A2B3C4D\thanjin\t123456789012', CARRIERS);

    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].carrier).toBe('hanjin');
  });

  it('전체 주문 UUID도 받는다', () => {
    const result = parseTrackingImport(`${ORDER_ID},hanjin,123456789012`, CARRIERS);

    expect(result.rows[0]).toMatchObject({ orderId: ORDER_ID, reference: ORDER_ID });
  });

  /* 운영자가 화면에서 보는 것은 표시명이고, WMS가 무엇을 내보낼지는 아직 모른다
     (#177). 둘 다 받아 두면 포맷 확인 전에도 파일이 통과한다. */
  it('택배사를 코드와 표시명 어느 쪽으로 적어도 푼다', () => {
    const result = parseTrackingImport('1A2B3C4D,한진택배,123456789012', CARRIERS);

    expect(result.rows[0].carrier).toBe('hanjin');
  });

  it('빈 줄과 BOM을 건너뛴다', () => {
    const result = parseTrackingImport(
      '﻿주문번호,택배사코드,운송장번호\n\n1A2B3C4D,hanjin,123456789012\n\n',
      CARRIERS,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it('따옴표로 감싼 칸의 따옴표를 벗긴다', () => {
    const result = parseTrackingImport('"1A2B3C4D","hanjin","123456789012"', CARRIERS);

    expect(result.rows[0]).toMatchObject({ reference: '1A2B3C4D', trackingNumber: '123456789012' });
  });
});

describe('parseTrackingImport · 행 단위 검증', () => {
  /* 실패 사유가 줄마다 다르므로 한 문장으로 접으면 운영자가 무엇을 고쳐 다시
     올릴지 알 수 없다. 줄 번호와 주문번호를 함께 남긴다. */
  it('칸이 모자란 줄을 줄 번호와 함께 되돌린다', () => {
    const result = parseTrackingImport('1A2B3C4D,hanjin', CARRIERS);

    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([{
      line: 1,
      reference: '1A2B3C4D',
      reason: '주문번호·택배사코드·운송장번호 세 칸이 모두 필요합니다.',
    }]);
  });

  it('주문번호 형식이 아니면 조회하지 않고 거절한다', () => {
    const result = parseTrackingImport('주문A,hanjin,123456789012', CARRIERS);

    expect(result.issues[0].reason).toContain('8자리 또는 전체 UUID');
  });

  it('레지스트리에 없는 택배사를 거절하고 입력값을 그대로 알린다', () => {
    const result = parseTrackingImport('1A2B3C4D,cj,123456789012', CARRIERS);

    expect(result.rows).toEqual([]);
    expect(result.issues[0].reason).toBe('등록되지 않은 택배사입니다: cj');
  });

  /* 계약이 끝난 택배사로 새 운송장을 붙이면 DB 게이트가 거절한다. 여기서 먼저
     막지 않으면 운영자는 이유를 알 수 없는 실패를 100줄 중 하나에서 본다. */
  it('비활성 택배사는 등록 대상에서 뺀다', () => {
    const result = parseTrackingImport('1A2B3C4D,retired_courier,123456789012', CARRIERS);

    expect(result.rows).toEqual([]);
    expect(result.issues[0].reason).toBe('지금 사용하지 않는 택배사입니다: 계약종료 택배');
  });

  it('DB 제약과 같은 운송장 형식만 통과시킨다', () => {
    const result = parseTrackingImport('1A2B3C4D,hanjin,1234', CARRIERS);

    expect(result.issues[0].reason).toBe('운송장번호는 하이픈을 뺀 8~30자리 영숫자여야 합니다.');
  });

  /* 같은 주문에 두 운송장이 적히면 나중 줄이 앞 줄을 덮어쓴다. 어느 쪽이 맞는지는
     파일을 만든 사람만 안다 — 조용히 덮어쓰지 않는다. */
  it('파일 안에서 중복된 주문번호를 앞 줄 번호와 함께 거절한다', () => {
    const result = parseTrackingImport(
      ['1A2B3C4D,hanjin,123456789012', '1a2b3c4d,hanjin,999999999999'].join('\n'),
      CARRIERS,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ line: 2, reason: '1번째 줄과 주문번호가 중복됩니다.' });
  });

  /* 한 줄이 틀렸다고 나머지를 버리면 창고에서 이미 나간 물건의 운송장이 통째로
     되돌아간다. 성공한 줄은 성공한 채로 남는다. */
  it('실패한 줄이 있어도 나머지 줄을 계속 읽는다', () => {
    const result = parseTrackingImport(
      ['1A2B3C4D,cj,123456789012', '5E6F7A8B,hanjin,987654321098'].join('\n'),
      CARRIERS,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].reference).toBe('5E6F7A8B');
    expect(result.issues).toHaveLength(1);
  });
});

describe('TRACKING_IMPORT_SAMPLE', () => {
  /* 화면이 안내하는 예시가 실제로 파싱되지 않으면 운영자는 그대로 따라 하다 막힌다. */
  it('화면에 안내하는 예시가 파서를 그대로 통과한다', () => {
    const result = parseTrackingImport(TRACKING_IMPORT_SAMPLE, CARRIERS);

    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });
});
