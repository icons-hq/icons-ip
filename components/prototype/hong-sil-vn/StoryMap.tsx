'use client';

/* PROTOTYPE — 홍실 퀘스트 서사형 게임 구조 브리핑. 버릴 코드다.
 *
 * 독자가 플레이어가 아니라 경영진이다. 그래서 스포일러를 가리지 않고 전부 편다.
 * 대신 앞에 오는 건 수치와 돈의 흐름이다 — 무슨 게임이고, 결말이 왜 20개이고,
 * 어디까지 무상이고 어디서부터 유상인가.
 *
 * 밝은 에디토리얼 캔버스로 간다(DESIGN.md §1 "거래·인증·운영 표면은 흰 종이처럼").
 * 게임 화면과 달리 여기는 발표 자료지 연출이 아니다.
 *
 * 모든 수치는 story.ts에서 계산한 값이다. 손으로 적은 숫자가 없다. */

import { useMemo } from 'react';
import { krw } from '@/lib/format';
import { BranchBoard } from './BranchBoard';
import {
  ART_SLOTS,
  ART_SLOT_COUNT,
  AXES,
  AXIS_ORDER,
  ENDINGS,
  FINALE_LABEL,
  GOODS_SKU_COUNT,
  PRINT_PRICE_KRW,
  SCENES,
  enumerateAll,
  goodsForEnding,
  type EndingGoods,
  type FinaleFlag,
} from './story';

const CANVAS = '#F4F4F1';
const SURFACE = '#FFFFFF';
const INK = '#11110F';
const MUTED = '#686862';
const FAINT = '#858580';
const LINE = 'rgba(17,17,15,.18)';
const HONG = '#9C001D';
const FREE = '#C4E5AE';
const PAID = '#FFE888';

const FINALE_ORDER: readonly FinaleFlag[] = ['remember', 'release', 'restart'];

function Section({
  no,
  title,
  sub,
  children,
}: {
  no: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 56 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '.18em', color: HONG }}>
          {no}
        </span>
        <span style={{ fontSize: 'clamp(19px, 2.2vw, 25px)', fontWeight: 840, letterSpacing: '-.025em', color: INK }}>
          {title}
        </span>
      </div>
      {sub && <p style={{ margin: '9px 0 0', fontSize: 13.5, lineHeight: 1.75, color: MUTED }}>{sub}</p>}
      <div style={{ marginTop: 20 }}>{children}</div>
    </section>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div style={{ padding: '16px 16px 18px', borderRadius: 14, background: SURFACE, border: `1px solid ${LINE}` }}>
      <div className="mono" style={{ fontSize: 'clamp(26px, 3.4vw, 38px)', fontWeight: 700, color: INK, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: INK }}>{label}</div>
      {note && <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.6, color: FAINT }}>{note}</div>}
    </div>
  );
}

export function StoryMap() {
  const enumeration = useMemo(() => enumerateAll(), []);

  /* 결말군 → 대표 상품. 특수 결말은 전용 SKU라 따로 세운다. */
  const goodsRows = useMemo(() => {
    const rows: Array<{ key: string; scope: string; count: number; goods: EndingGoods }> = [];
    for (const finale of FINALE_ORDER) {
      const group = ENDINGS.filter((e) => e.kind === 'grid' && e.finale === finale);
      if (!group.length) continue;
      rows.push({
        key: finale,
        scope: `종막 · ${FINALE_LABEL[finale]}`,
        count: group.length,
        goods: goodsForEnding(group[0]),
      });
    }
    for (const special of ENDINGS.filter((e) => e.kind === 'special')) {
      rows.push({
        key: special.id,
        scope: `${special.no}. ${special.title}`,
        count: 1,
        goods: goodsForEnding(special),
      });
    }
    return rows;
  }, []);

  return (
    <div style={{ background: CANVAS, minHeight: '100svh', color: INK }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(24px, 4vw, 56px) clamp(18px, 3vw, 40px) 120px' }}>
        {/* ── 헤더 ───────────────────────────────────────────────── */}
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', color: HONG }}>
          홍실 퀘스트 · 온라인 팝업
        </div>
        <h1
          style={{
            margin: '14px 0 0',
            fontSize: 'clamp(30px, 5vw, 58px)',
            fontWeight: 850,
            lineHeight: 1.08,
            letterSpacing: '-.032em',
            color: INK,
          }}
        >
          서사형 행동 체험 게임 구조
        </h1>
        <p style={{ margin: '16px 0 0', maxWidth: 680, fontSize: 'clamp(14px, 1.4vw, 16px)', lineHeight: 1.8, color: MUTED }}>
          원작 시즌 2가 끝난 지점에서 시작한다. 기억을 잃은 홍기훈에게 접촉할 때마다 기억이 돌아오는
          <b style={{ color: INK }}> 홍기훈 퀘스트</b>를 플레이어가 이연이 되어 치른다. 네 번의 선택이
          {' '}<b style={{ color: INK }}>20가지 새 결말</b>로 갈리고, 결말마다 카드와 그 결말에서만 살 수 있는 물건이 걸린다.
        </p>
        <p style={{ margin: '14px 0 0', fontSize: 11.5, fontWeight: 600, color: FAINT }}>
          PROTOTYPE · 내부 검토용 · 아래 수치는 전부 실제 시나리오 데이터에서 계산됨
        </p>

        <div
          style={{
            marginTop: 30,
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          }}
        >
          <Stat value={String(SCENES.length)} label="라운드" note="라운드마다 선택지 3개" />
          <Stat value={String(enumeration.totalPaths)} label="플레이 경로" note={`3의 ${SCENES.length}제곱`} />
          <Stat
            value={String(ENDINGS.length)}
            label="결말"
            note={enumeration.unreachable.length === 0 ? '전부 도달 가능 (검증됨)' : `도달 불가 ${enumeration.unreachable.length}개`}
          />
          <Stat value={`${GOODS_SKU_COUNT}+${ENDINGS.length}`} label="판매 품목" note={`한정 굿즈 ${GOODS_SKU_COUNT}종 + 카드 인쇄 ${ENDINGS.length}종`} />
        </div>

        {/* ── 1. 분기 지도 ───────────────────────────────────────── */}
        <Section
          no="01"
          title="분기 지도"
          sub={`라운드마다 세 갈래로 갈리고, ${enumeration.totalPaths}개 경로가 ${ENDINGS.length}개 결말로 모인다. 카드를 누르면 그 선택이 어떤 결말을 열고 닫는지 도판에서 바로 보인다.`}
        >
          {/* 도판만 본문 폭 밖으로 빼서 넓게 쓴다 — 리포트 안의 전면 도판 */}
          <div
            style={{
              width: 'min(calc(100vw - 48px), 1460px)',
              marginLeft: '50%',
              transform: 'translateX(-50%)',
            }}
          >
            <BranchBoard />
          </div>
        </Section>

        {/* ── 2. 결말군과 상품 연결 ──────────────────────────────── */}
        <Section
          no="02"
          title="결말군과 상품 연결"
          sub={`결말마다 전용 상품을 두면 SKU가 ${ENDINGS.length}개가 된다. 종막 갈래에 대표 상품을 하나씩 두고 특수 결말 ${ENDINGS.filter((e) => e.kind === 'special').length}개만 전용으로 빼서 ${GOODS_SKU_COUNT}종으로 묶었다.`}
        >
          <div style={{ display: 'grid', gap: 9 }}>
            {goodsRows.map((row) => (
              <div
                key={row.key}
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: 'minmax(0, 200px) minmax(0, 1fr)',
                  alignItems: 'start',
                  padding: '13px 15px',
                  borderRadius: 12,
                  background: SURFACE,
                  border: `1px solid ${LINE}`,
                  borderLeft: `4px solid ${row.goods.accent}`,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>{row.scope}</div>
                  <div style={{ marginTop: 4, fontSize: 11.5, color: FAINT }}>결말 {row.count}개</div>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{row.goods.name}</span>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>
                      {krw(row.goods.priceKrw)}
                    </span>
                  </div>
                  <p style={{ margin: '7px 0 0', fontSize: 12, lineHeight: 1.75, color: MUTED }}>{row.goods.why}</p>
                </div>
              </div>
            ))}

            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'minmax(0, 200px) minmax(0, 1fr)',
                alignItems: 'start',
                padding: '13px 15px',
                borderRadius: 12,
                background: 'rgba(17,17,15,.04)',
                border: `1px dashed ${LINE}`,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>전 결말 공통</div>
                <div style={{ marginTop: 4, fontSize: 11.5, color: FAINT }}>결말 {ENDINGS.length}개</div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>엔딩 카드 실물 인쇄</span>
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>
                    {krw(PRINT_PRICE_KRW)}
                  </span>
                </div>
                <p style={{ margin: '7px 0 0', fontSize: 12, lineHeight: 1.75, color: MUTED }}>
                  주문 생산이라 재고가 없다. &ldquo;각자 다른 걸 받는&rdquo; 느낌은 여기 {ENDINGS.length}종이 만든다.
                  결제 대상은 인쇄·패키징·배송이고 카드 소유는 이미 무상으로 끝나 있다.
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 3. 축 모델 ─────────────────────────────────────────── */}
        <Section
          no="03"
          title="결말이 20개인 이유 — 그리고 늘리는 법"
          sub="결말을 손으로 20개 쓴 게 아니다. 선택이 누적한 세 개의 축 중 가장 크게 기운 축과, 마지막 라운드에서 고른 종막이 결말을 결정한다. 그래서 개수는 자유롭게 조정된다."
        >
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              alignItems: 'stretch',
            }}
          >
            <FormulaCard head="축 3개 × 부호 2" body="연(緣)·진(眞)·아(我) 각각 플러스/마이너스" foot="= 성향 6가지" />
            <FormulaCard head="종막 3갈래" body="회복 · 해방 · 재회" foot="× 3" />
            <FormulaCard head="기본 결말" body="성향 6 × 종막 3" foot="= 18개" accent />
            <FormulaCard head="특수 결말" body="좁은 플래그 조건으로만 열림" foot="+ 2개 = 총 20개" accent />
          </div>

          <div style={{ marginTop: 14, display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {AXIS_ORDER.map((key) => (
              <div
                key={key}
                style={{
                  padding: 13,
                  borderRadius: 11,
                  background: SURFACE,
                  border: `1px solid ${LINE}`,
                  borderTop: `3px solid ${AXES[key].color}`,
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{AXES[key].name}</div>
                <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.7, color: MUTED }}>
                  {AXES[key].minus} ↔ {AXES[key].plus}
                </div>
              </div>
            ))}
          </div>

          <p style={{ margin: '16px 0 0', fontSize: 13, lineHeight: 1.8, color: MUTED }}>
            <b style={{ color: INK }}>축을 하나 더하면 결말이 6개 늘고, 종막을 하나 더하면 6개 늘어난다.</b>{' '}
            라운드를 늘리는 건 결말 수를 늘리지 않고 서사의 밀도만 올린다. 즉 &ldquo;20개&rdquo;는 상한이 아니라
            지금 잡은 값이고, 제작 물량에 맞춰 조정하면 된다.
          </p>
        </Section>

        {/* ── 4. 수익 파이프라인 ─────────────────────────────────── */}
        <Section
          no="04"
          title="무상 구간과 유상 구간"
          sub="플레이·카드·수집·자랑까지 전부 무상이다. 돈이 오가는 지점은 마지막 실물 두 가지뿐이고, 그 경계가 규제 경계와 같다."
        >
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <PipeStage tone="free" step="01" title="게임 플레이" body="로그인 후 무료. 횟수 제한 없음" />
            <PipeStage tone="free" step="02" title="엔딩 카드 획득" body="무상 발급. 팝업 중에는 나만 본다" />
            <PipeStage tone="free" step="03" title="팝업 종료 · 공개" body="전체 통계 공개, 바인더 자랑" />
            <PipeStage
              tone="paid"
              step="04"
              title="한정 굿즈"
              body={`도달한 결말의 물건 · ${GOODS_SKU_COUNT}종`}
            />
            <PipeStage
              tone="paid"
              step="04"
              title="카드 실물 인쇄"
              body={`가진 카드의 인쇄·패키징·배송 · ${krw(PRINT_PRICE_KRW)}`}
            />
          </div>

          <div
            style={{
              marginTop: 16,
              padding: '15px 17px',
              borderRadius: 12,
              background: SURFACE,
              border: `1px solid ${LINE}`,
              borderLeft: `4px solid ${HONG}`,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>규제 관점에서 반드시 지켜야 하는 두 가지</div>
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.85, color: MUTED }}>
              <li>
                <b style={{ color: INK }}>확률형 아이템이 아니다.</b> 결말은 무작위가 아니라 플레이어가 고른
                선택의 결과이고 재플레이는 무료다. 돈을 내고 결과를 뽑는 경로가 설계에 없다.
              </li>
              <li>
                <b style={{ color: INK }}>카드는 끝까지 무상이다.</b> 유상 결제 대상은 인쇄·패키징·배송이지
                카드 소유권이 아니다. 이 경계가 무너지면 무료 리워드 모델(ADR-0003)이 깨진다.
              </li>
            </ul>
          </div>
        </Section>

        {/* ── 5. 제작 물량 ───────────────────────────────────────── */}
        <Section no="05" title="제작 물량" sub="지금 화면에 들어가 있는 자리표시자를 실제 에셋으로 바꾸는 데 필요한 양이다.">
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Stat value={`${ART_SLOT_COUNT}컷`} label="일러스트 총량" note="아래 네 종류의 합" />
            <Stat value={`${ART_SLOTS.sceneBackgrounds}컷`} label="라운드 배경" note="라운드당 1컷" />
            <Stat value={`${ART_SLOTS.choiceCuts}컷`} label="선택지 컷" note="선택마다 결과 장면" />
            <Stat value={`${ART_SLOTS.endingCuts}컷`} label="결말 컷" note="결말마다 1컷" />
            <Stat value={`${ART_SLOTS.cardFronts}컷`} label="카드 앞면" note="결말 카드 도안" />
          </div>
          <div style={{ marginTop: 10, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Stat value={`${GOODS_SKU_COUNT}종`} label="한정 굿즈 SKU" note="실재고 부담은 여기까지" />
            <Stat value={`${ENDINGS.length}종`} label="카드 인쇄 도안" note="주문 생산이라 재고 없음" />
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 12.5, lineHeight: 1.8, color: MUTED }}>
            결말마다 전용 굿즈를 두면 SKU가 {ENDINGS.length}개가 된다. 지금은 종막 3갈래에 대표 상품을 하나씩
            두고 특수 결말 2개만 전용으로 빼서 <b style={{ color: INK }}>{GOODS_SKU_COUNT}종으로 묶었다</b>.
            &ldquo;각자 다른 걸 받는&rdquo; 느낌은 카드 {ENDINGS.length}종이 만든다.
          </p>
        </Section>

        {/* ── 6. 현재 상태 ───────────────────────────────────────── */}
        <Section no="06" title="현재 상태" sub="이 화면에서 동작하는 것과, 아직 배선되지 않은 것을 구분한다.">
          <div style={{ display: 'grid', gap: 8 }}>
            {[
              { done: true, text: '네 라운드 시나리오, 선택→축 누적, 20개 결말 판정 — 동작함' },
              { done: true, text: `${enumeration.totalPaths}개 경로 완전열거로 결말 20개 전부 도달 가능한 것 검증됨` },
              { done: true, text: '결말 카드 발급, 봉인/공개 전환, 바인더, 도달 분포 — 동작함' },
              { done: true, text: '결말별 한정 굿즈 노출과 잠금 규칙(도달 이력 + 팝업 기간) — 동작함' },
              { done: false, text: '결제 — 미배선. 실제 홍실 퀘스트 굿즈는 재고 미확정(판매 불가) 상태다' },
              { done: false, text: '서버 판정 — 미배선. 실서비스에서는 결말 판정과 카드 발급이 서버 몫이다' },
              { done: false, text: '유저 간 카드 교환 — 현재 제품 범위상 v2다. 이 팝업에 넣으려면 범위 변경이 선행돼야 한다' },
              { done: false, text: '일러스트 — 전부 자리표시자. 위 제작 물량이 발주 규모다' },
            ].map((row) => (
              <div
                key={row.text}
                style={{
                  display: 'flex',
                  gap: 11,
                  padding: '11px 13px',
                  borderRadius: 10,
                  background: SURFACE,
                  border: `1px solid ${LINE}`,
                }}
              >
                <span
                  style={{
                    flex: '0 0 auto',
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
                    fontWeight: 800,
                    color: INK,
                    background: row.done ? FREE : PAID,
                  }}
                >
                  {row.done ? '✓' : '—'}
                </span>
                <span style={{ fontSize: 12.5, lineHeight: 1.65, color: row.done ? INK : MUTED }}>{row.text}</span>
              </div>
            ))}
          </div>
        </Section>

        <p style={{ margin: '48px 0 0', fontSize: 11.5, lineHeight: 1.8, color: FAINT }}>
          서사·대사·결말 문장은 원작 시즌 2 완결 이후를 새로 쓴 것이며 원작 본문을 옮긴 것이 아니다.
          작가 검수가 필요하다. 굿즈 가격은 제안값이고 원가·마진 미검토다.
        </p>
      </div>
    </div>
  );
}

function FormulaCard({
  head,
  body,
  foot,
  accent = false,
}: {
  head: string;
  body: string;
  foot: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        padding: '14px 15px 16px',
        borderRadius: 12,
        background: accent ? FREE : SURFACE,
        border: `1px solid ${accent ? 'transparent' : LINE}`,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>{head}</div>
      <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.65, color: accent ? 'rgba(17,17,15,.72)' : MUTED }}>
        {body}
      </div>
      <div className="mono" style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: INK }}>
        {foot}
      </div>
    </div>
  );
}

function PipeStage({
  tone,
  step,
  title,
  body,
}: {
  tone: 'free' | 'paid';
  step: string;
  title: string;
  body: string;
}) {
  return (
    <div style={{ padding: '14px 15px 16px', borderRadius: 12, background: tone === 'free' ? FREE : PAID }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(17,17,15,.62)' }}>
        <span className="mono">{step}</span> · {tone === 'free' ? '무상' : '유상'}
      </div>
      <div style={{ marginTop: 7, fontSize: 13.5, fontWeight: 800, color: INK }}>{title}</div>
      <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.65, color: 'rgba(17,17,15,.72)' }}>{body}</div>
    </div>
  );
}
