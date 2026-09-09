import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA } from './data';
import {
  BID_STEP,
  ESCROW_STEPS,
  MARKET_FEE_RATE,
  MARKET_LISTINGS,
  SECONDARY_MARKET_DEMO_ENABLED,
  TRADE_LISTINGS,
  formatCountdown,
  minNextBid,
  sellerPayout,
} from './secondary-market-demo';

/* 시연 mock 은 실데이터가 아니지만, 발표 화면에서 깨진 이미지·없는 IP 가 보이면 안 된다. */
const imagePath = (bg: string) => /url\("([^"]+)"\)/.exec(bg)?.[1] ?? null;

describe('세컨더리 마켓 시연 데이터', () => {
  it('스위치가 켜져 있다 — 끄면 서버 게이트·푸터 진입점이 함께 닫힌다', () => {
    expect(SECONDARY_MARKET_DEMO_ENABLED).toBe(true);
  });

  it('매물·트레이드 id 가 서로 겹치지 않는다', () => {
    const ids = [...MARKET_LISTINGS, ...TRADE_LISTINGS].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('모든 매물·트레이드가 현재 카탈로그 mock 의 IP 를 가리킨다', () => {
    const ipIds = new Set(DATA.IPS.map((ip) => ip.id));
    for (const item of [...MARKET_LISTINGS, ...TRADE_LISTINGS]) {
      expect(ipIds.has(item.ip), item.id).toBe(true);
    }
  });

  it('모든 이미지가 public/generated 에 실재한다', () => {
    for (const item of [...MARKET_LISTINGS, ...TRADE_LISTINGS]) {
      const path = imagePath(item.bg);
      expect(path, item.id).not.toBeNull();
      expect(existsSync(join(process.cwd(), 'public', path!)), item.id).toBe(true);
    }
  });

  it('경매는 현재가·입찰 수·마감을, 직거래는 원하는 조건을 가진다', () => {
    for (const trade of TRADE_LISTINGS) {
      if (trade.kind === '경매') {
        expect(trade.bid).toBeGreaterThan(0);
        expect(trade.bids).toBeGreaterThanOrEqual(0);
        expect(trade.endsInSec).toBeGreaterThan(0);
      } else {
        expect(trade.want.length).toBeGreaterThan(0);
      }
    }
    expect(TRADE_LISTINGS.some((trade) => trade.kind === '경매')).toBe(true);
    expect(TRADE_LISTINGS.some((trade) => trade.kind === '직거래')).toBe(true);
  });

  it('안전 거래 프로세스는 검수 → 에스크로 → 정산 순서다', () => {
    expect(ESCROW_STEPS.map((step) => step.title)).toEqual(['검수센터 입고', '에스크로 결제', '확정 후 정산']);
  });
});

describe('세컨더리 마켓 시연 파생', () => {
  it('다음 입찰 하한은 현재가 + 입찰 단위다', () => {
    expect(minNextBid(12000)).toBe(12000 + BID_STEP);
  });

  it('판매자 정산 예정액은 예시 수수료를 뺀 값을 원 단위로 내린다', () => {
    expect(sellerPayout(39000)).toBe(Math.floor(39000 * (1 - MARKET_FEE_RATE)));
    expect(sellerPayout(39999)).toBe(Math.floor(39999 * (1 - MARKET_FEE_RATE)));
  });

  it('카운트다운은 HH:MM:SS 로 쓰고 마감 뒤에는 00:00:00 에서 멈춘다', () => {
    expect(formatCountdown(3 * 3600 + 21 * 60 + 40)).toBe('03:21:40');
    expect(formatCountdown(59)).toBe('00:00:59');
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(-30)).toBe('00:00:00');
  });
});
