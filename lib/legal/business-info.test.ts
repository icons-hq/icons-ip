import { describe, expect, it } from 'vitest';
import {
  BUSINESS_INFO,
  BUSINESS_INFO_LABELS,
  businessContactRows,
  businessContactWords,
  businessInfoRows,
  type BusinessInfo,
} from './business-info';

const filled: BusinessInfo = {
  companyName: '주식회사 아이콘즈',
  representative: '박상우',
  registrationNumber: '000-00-00000',
  mailOrderNumber: '제2026-서울강남-00000호',
  address: '서울특별시 강남구 테헤란로 000, 0층',
  phone: '02-0000-0000',
  email: 'help@icons.gg',
  hostingProvider: 'Vercel, Inc.',
};

const blank: BusinessInfo = {
  companyName: '',
  representative: '',
  registrationNumber: '',
  mailOrderNumber: '',
  address: '',
  phone: '',
  email: '',
  hostingProvider: '',
};

describe('사업자 정보 상수', () => {
  it('전자상거래법이 요구하는 항목마다 라벨이 하나씩 있다', () => {
    expect(Object.keys(BUSINESS_INFO_LABELS)).toEqual(Object.keys(BUSINESS_INFO));
  });

  it('값 주입 지점이 상수 하나로 모여 있다 — 모든 값이 문자열이다', () => {
    for (const value of Object.values(BUSINESS_INFO)) {
      expect(typeof value).toBe('string');
    }
  });
});

describe('businessInfoRows', () => {
  it('법정 표기 순서대로 행을 만든다', () => {
    expect(businessInfoRows(filled).map((row) => [row.label, row.value])).toEqual([
      ['상호', '주식회사 아이콘즈'],
      ['대표자', '박상우'],
      ['사업자등록번호', '000-00-00000'],
      ['통신판매업 신고번호', '제2026-서울강남-00000호'],
      ['사업장 주소', '서울특별시 강남구 테헤란로 000, 0층'],
      ['전화', '02-0000-0000'],
      ['이메일', 'help@icons.gg'],
      ['호스팅 제공자', 'Vercel, Inc.'],
    ]);
  });

  it('빈 값과 공백뿐인 값은 행 자체를 만들지 않는다 — 신고 전 배포에서 빈 라벨이 노출되면 안 된다', () => {
    const rows = businessInfoRows({
      ...blank,
      companyName: '주식회사 아이콘즈',
      registrationNumber: '   ',
      hostingProvider: 'Vercel, Inc.',
    });

    expect(rows.map((row) => row.key)).toEqual(['companyName', 'hostingProvider']);
    expect(rows.every((row) => row.value === row.value.trim() && row.value.length > 0)).toBe(true);
  });

  it('값이 하나도 없으면 빈 배열이라 표기 블록 자체가 사라진다', () => {
    expect(businessInfoRows(blank)).toEqual([]);
  });

  it('기본값은 현재 확정된 사업자 정보를 그대로 쓴다', () => {
    expect(businessInfoRows()).toEqual(businessInfoRows(BUSINESS_INFO));
  });
});

describe('문의 창구 파생', () => {
  it('이용자가 실제로 닿을 수 있는 항목만 창구로 본다 — 호스팅 제공자는 창구가 아니다', () => {
    expect(businessContactRows(filled).map((row) => row.key)).toEqual(['phone', 'email']);
    expect(businessContactWords(filled)).toBe('전화 02-0000-0000 · 이메일 help@icons.gg');
  });

  /*
   * 사업자등록증에 대표자명이 먼저 확정되므로 #87 진행 중 반드시 거치는 중간 상태다.
   * 이름표를 창구로 세면 문서가 다시 닿을 수 없는 곳을 유일한 권리 행사 경로로 지정한다.
   */
  it('대표자명만 채워진 상태는 창구가 생긴 것으로 보지 않는다', () => {
    expect(businessContactWords({ ...blank, representative: '박상우' })).toBe('');
  });

  it('연락처가 하나도 없으면 빈 문자열이다 — 법정 문서가 없는 창구를 가리키지 않게 하는 신호다 (#87)', () => {
    expect(businessContactRows({ ...blank, hostingProvider: 'Vercel, Inc.' })).toEqual([]);
    expect(businessContactWords({ ...blank, hostingProvider: 'Vercel, Inc.' })).toBe('');
  });

  it('일부만 채워져도 채워진 항목만 창구로 드러난다', () => {
    expect(businessContactWords({ ...blank, email: 'help@icons.gg' })).toBe('이메일 help@icons.gg');
  });
});
