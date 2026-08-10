'use client';

import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './hong-sil-kuji.module.css';

type Variant = 'A' | 'B' | 'C';
type TierId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
type TicketStatus = 'available' | 'sold';

type Prize = {
  tier: TierId;
  name: string;
  detail: string;
  image: string;
  initialCount: number;
};

type TicketState = {
  position: number;
  status: TicketStatus;
};

type BoxState = {
  id: string;
  label: string;
  note: string;
  tickets: TicketState[];
  remainingTiers: TierId[];
  lastOneClaimed: boolean;
};

type Award = {
  position: number;
  tier: TierId;
};

type RevealResult = {
  id: number;
  boxId: string;
  boxLabel: string;
  awards: Award[];
  lastOne: boolean;
};

const PRIZES: Prize[] = [
  {
    tier: 'A',
    name: '붉은 실 자수 쿠션',
    detail: '대형 벨벳 파이핑 쿠션',
    image: '/generated/hong-sil-kuji/goods/tier-a-cushion.webp',
    initialCount: 1,
  },
  {
    tier: 'B',
    name: '홍실 라인아트 블랭킷',
    detail: '포근한 대형 패브릭',
    image: '/generated/hong-sil-kuji/goods/tier-b-blanket.webp',
    initialCount: 2,
  },
  {
    tier: 'C',
    name: '퀘스트 데일리 토트',
    detail: '크림 캔버스 토트백',
    image: '/generated/hong-sil-kuji/goods/tier-c-tote.webp',
    initialCount: 3,
  },
  {
    tier: 'D',
    name: '금실 스티치 파우치',
    detail: '버건디 패브릭 파우치',
    image: '/generated/hong-sil-kuji/goods/tier-d-pouch.webp',
    initialCount: 4,
  },
  {
    tier: 'E',
    name: '페어 보온 텀블러',
    detail: '캐릭터 2종 한 세트',
    image: '/generated/hong-sil-kuji/goods/tier-e-tumblers.webp',
    initialCount: 5,
  },
  {
    tier: 'F',
    name: '오로라 아크릴 키링',
    detail: '캐릭터 2종 중 1종',
    image: '/generated/hong-sil-kuji/goods/tier-f-keyrings.webp',
    initialCount: 7,
  },
  {
    tier: 'G',
    name: '붉은 실 문구 세트',
    detail: '스티커·엽서·메모패드',
    image: '/generated/hong-sil-kuji/goods/tier-g-stationery.webp',
    initialCount: 8,
  },
];

const PRIZE_BY_TIER = new Map(PRIZES.map((prize) => [prize.tier, prize]));

const FULL_TIER_POOL: TierId[] = [
  'G', 'F', 'E', 'D', 'C', 'G', 'F', 'E', 'B', 'G',
  'F', 'D', 'E', 'G', 'C', 'F', 'G', 'E', 'D', 'F',
  'G', 'E', 'F', 'G', 'A', 'B', 'C', 'D', 'F', 'G',
];

const BOX_DEFINITIONS = [
  {
    id: 'box-01',
    label: '박스 01',
    note: '처음부터 체험',
    soldBefore: 0,
    remainingTiers: FULL_TIER_POOL,
  },
  {
    id: 'box-02',
    label: '박스 02',
    note: '중간 구간 체험',
    soldBefore: 12,
    remainingTiers: ['G', 'F', 'E', 'D', 'C', 'G', 'F', 'E', 'B', 'G', 'F', 'D', 'E', 'G', 'C', 'F', 'G', 'A'],
  },
  {
    id: 'box-03',
    label: '박스 03',
    note: '마지막 상 체험',
    soldBefore: 24,
    remainingTiers: ['A', 'B', 'C', 'D', 'F', 'G'],
  },
] as const;

const VARIANTS: Variant[] = ['A', 'B', 'C'];
const VARIANT_DETAILS: Record<Variant, { label: string; description: string }> = {
  A: { label: '굿즈 중심', description: '상품 살펴보기' },
  B: { label: '잔여 현황', description: '남은 구성 확인' },
  C: { label: '이야기 몰입', description: '붉은 실을 따라' },
};
const SAMPLE_UNIT_PRICE = 7_000;
const MAX_PER_ROUND = 10;
const PRICE_FORMATTER = new Intl.NumberFormat('ko-KR');

function normalizeVariant(value?: string): Variant {
  const normalized = value?.toUpperCase();
  return normalized === 'B' || normalized === 'C' ? normalized : 'A';
}

function createInitialBoxes(): BoxState[] {
  return BOX_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    note: definition.note,
    tickets: FULL_TIER_POOL.map((_, index) => ({
      position: index + 1,
      status: index < definition.soldBefore ? 'sold' : 'available',
    })),
    remainingTiers: [...definition.remainingTiers],
    lastOneClaimed: false,
  }));
}

function availableCount(box: BoxState) {
  return box.tickets.reduce((count, ticket) => count + (ticket.status === 'available' ? 1 : 0), 0);
}

function remainingByTier(box: BoxState) {
  const counts = new Map<TierId, number>(PRIZES.map((prize) => [prize.tier, 0]));
  for (const tier of box.remainingTiers) {
    counts.set(tier, (counts.get(tier) ?? 0) + 1);
  }
  return counts;
}

function drawFromPool(pool: TierId[], count: number) {
  const shuffled = [...pool];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    const swapIndex = random % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return { drawn: shuffled.slice(0, count), remaining: shuffled.slice(count) };
}

function formatPrice(value: number) {
  return PRICE_FORMATTER.format(value);
}

export function HongSilKujiPrototype({ initialVariant }: { initialVariant?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const variant = normalizeVariant(searchParams.get('variant') ?? initialVariant);
  const [boxes, setBoxes] = useState<BoxState[]>(createInitialBoxes);
  const [activeBoxId, setActiveBoxId] = useState('box-01');
  const [quantity, setQuantity] = useState(1);
  const [selectedPositions, setSelectedPositions] = useState<number[]>([]);
  const [latestResult, setLatestResult] = useState<RevealResult | null>(null);
  const [history, setHistory] = useState<RevealResult[]>([]);

  const activeBox = boxes.find((box) => box.id === activeBoxId) ?? boxes[0];
  const remaining = availableCount(activeBox);
  const tierCounts = useMemo(() => remainingByTier(activeBox), [activeBox]);
  const totalRemaining = boxes.reduce((total, box) => total + availableCount(box), 0);
  const awardedGoods = history.reduce((total, result) => total + result.awards.length + (result.lastOne ? 1 : 0), 0);

  const changeVariant = useCallback((next: Variant) => {
    const params = new URLSearchParams(window.location.search);
    params.set('variant', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) return;

      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const currentIndex = VARIANTS.indexOf(variant);
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (currentIndex + delta + VARIANTS.length) % VARIANTS.length;
      changeVariant(VARIANTS[nextIndex]);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeVariant, variant]);

  const chooseBox = (boxId: string) => {
    const nextBox = boxes.find((box) => box.id === boxId);
    if (!nextBox) return;
    setActiveBoxId(boxId);
    setSelectedPositions([]);
    setLatestResult(null);
    setQuantity(Math.min(1, availableCount(nextBox)));
  };

  const chooseQuantity = (nextQuantity: number) => {
    if (remaining === 0) return;
    const clamped = Math.max(1, Math.min(nextQuantity, remaining, MAX_PER_ROUND));
    setQuantity(clamped);
    setSelectedPositions((current) => current.slice(0, clamped));
    setLatestResult(null);
  };

  const togglePosition = (position: number) => {
    const ticket = activeBox.tickets.find((candidate) => candidate.position === position);
    if (!ticket || ticket.status !== 'available' || quantity === 0) return;

    setSelectedPositions((current) => {
      if (current.includes(position)) return current.filter((item) => item !== position);
      if (current.length >= quantity) return current;
      return [...current, position];
    });
    setLatestResult(null);
  };

  const reveal = () => {
    if (quantity === 0 || selectedPositions.length !== quantity) return;

    const selectedSet = new Set(selectedPositions);
    const chosenPositions = activeBox.tickets
      .filter((ticket) => selectedSet.has(ticket.position) && ticket.status === 'available')
      .map((ticket) => ticket.position);
    if (chosenPositions.length !== quantity || activeBox.remainingTiers.length < quantity) return;

    const drawn = drawFromPool(activeBox.remainingTiers, quantity);
    const awards = chosenPositions.map((position, index) => ({ position, tier: drawn.drawn[index] }));

    const winsLastOne = remaining === awards.length && !activeBox.lastOneClaimed;
    const result: RevealResult = {
      id: history.length + 1,
      boxId: activeBox.id,
      boxLabel: activeBox.label,
      awards,
      lastOne: winsLastOne,
    };

    setBoxes((current) => current.map((box) => {
      if (box.id !== activeBox.id) return box;
      return {
        ...box,
        lastOneClaimed: box.lastOneClaimed || winsLastOne,
        remainingTiers: drawn.remaining,
        tickets: box.tickets.map((ticket) => (
          selectedSet.has(ticket.position) ? { ...ticket, status: 'sold' as const } : ticket
        )),
      };
    }));
    setHistory((current) => [result, ...current]);
    setLatestResult(result);
    setSelectedPositions([]);
    setQuantity(Math.min(1, remaining - awards.length));
  };

  const reset = () => {
    setBoxes(createInitialBoxes());
    setActiveBoxId('box-01');
    setQuantity(1);
    setSelectedPositions([]);
    setLatestResult(null);
    setHistory([]);
  };

  const sharedProps = {
    boxes,
    activeBox,
    remaining,
    tierCounts,
    quantity,
    selectedPositions,
    latestResult,
    chooseBox,
    chooseQuantity,
    togglePosition,
    reveal,
  };

  return (
    <main className={styles.root}>
      <PrototypeHeader
        activeBox={activeBox}
        activeVariant={variant}
        awardedGoods={awardedGoods}
        historyCount={history.length}
        onChangeVariant={changeVariant}
        quantity={quantity}
        remaining={remaining}
        selectedCount={selectedPositions.length}
        totalRemaining={totalRemaining}
        onReset={reset}
      />

      {variant === 'A' ? <VariantA {...sharedProps} /> : null}
      {variant === 'B' ? <VariantB {...sharedProps} /> : null}
      {variant === 'C' ? <VariantC {...sharedProps} /> : null}

      <SessionLedger history={history} boxes={boxes} onReset={reset} />
    </main>
  );
}

type SharedVariantProps = {
  boxes: BoxState[];
  activeBox: BoxState;
  remaining: number;
  tierCounts: Map<TierId, number>;
  quantity: number;
  selectedPositions: number[];
  latestResult: RevealResult | null;
  chooseBox: (boxId: string) => void;
  chooseQuantity: (quantity: number) => void;
  togglePosition: (position: number) => void;
  reveal: () => void;
};

function PrototypeHeader({
  activeBox,
  activeVariant,
  awardedGoods,
  historyCount,
  onChangeVariant,
  quantity,
  remaining,
  selectedCount,
  totalRemaining,
  onReset,
}: {
  activeBox: BoxState;
  activeVariant: Variant;
  awardedGoods: number;
  historyCount: number;
  onChangeVariant: (variant: Variant) => void;
  quantity: number;
  remaining: number;
  selectedCount: number;
  totalRemaining: number;
  onReset: () => void;
}) {
  return (
    <header className={styles.prototypeHeader}>
      <div className={styles.brandLine}>
        <h1>홍실 행운상점</h1>
        <span className={styles.prototypeBadge}>PROTOTYPE · 결제 없음</span>
      </div>
      <VariantSwitcher active={activeVariant} onChange={onChangeVariant} />
      <div className={styles.liveState} aria-live="polite">
        <span><b>현재</b> {activeBox.label}</span>
        <span><b>남은 굿즈</b> {remaining} / 30</span>
        <span><b>선택</b> {selectedCount} / {quantity}</span>
        <span><b>전체 박스 잔여</b> {totalRemaining}</span>
        <span><b>체험</b> {historyCount}회</span>
        <span><b>받은 굿즈</b> {awardedGoods}개</span>
        <button type="button" onClick={onReset}>전체 초기화</button>
      </div>
    </header>
  );
}

function VariantA(props: SharedVariantProps) {
  return (
    <div className={styles.variantContent}>
      <section className={styles.stageHero}>
        <div className={styles.stageCopy}>
          <p className={styles.kicker}>SPECIAL GOODS ROUND</p>
          <h2>붉은 실 끝에서<br />오늘의 굿즈를 만나요</h2>
          <p>
            세 개의 시뮬레이션 박스 중 하나를 고르고, 남아 있는 봉인 번호를 선택해 결과를 확인하세요.
          </p>
          <p className={styles.trustCopy}>한 번 선택된 굿즈는 박스에서 정확히 한 개씩 사라집니다.</p>
          <a className={styles.jumpLink} href="#kuji-interaction">박스 체험 시작 <span aria-hidden>↓</span></a>
        </div>
        <div className={styles.stageArt}>
          <Image
            alt="붉은 배경 속 홍실퀘스트 두 주인공"
            fill
            loading="eager"
            sizes="(max-width: 760px) 100vw, 58vw"
            src="/generated/ip/hong-sil-quest.webp"
          />
        </div>
      </section>

      <section aria-labelledby="a-prizes" className={styles.prizeShelf}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>GOODS LINE-UP</p>
            <h2 id="a-prizes">남은 굿즈</h2>
          </div>
          <p>{props.activeBox.label}의 현재 구성입니다. 새로고침하면 처음 상태로 돌아갑니다.</p>
        </div>
        <PrizeCards tierCounts={props.tierCounts} mode="shelf" />
        <LastOneCard compact />
      </section>

      <section className={styles.aInteraction} id="kuji-interaction">
        <BoxPicker {...props} />
        <ControlPanel {...props} />
        <TicketGrid {...props} />
        <RevealAction {...props} />
      </section>
      <ResultPanel result={props.latestResult} />
    </div>
  );
}

function VariantB(props: SharedVariantProps) {
  return (
    <div className={styles.variantContent}>
      <section className={styles.boardIntro}>
        <div>
          <p className={styles.kicker}>EXACT INVENTORY BOARD</p>
          <h2>남은 구성을 먼저 보고 차분하게 선택하세요</h2>
        </div>
        <p>
          선택 위치는 공개된 잔여 구성을 바꾸지 않습니다. 이 화면의 숫자는 프로토타입 메모리 상태를 그대로 반영합니다.
        </p>
      </section>
      <section className={styles.dataBoard} id="kuji-interaction">
        <div className={styles.boardBoxes}><BoxPicker {...props} /></div>
        <div className={styles.boardCenter}>
          <ControlPanel {...props} />
          <TicketGrid {...props} />
          <RevealAction {...props} />
          <ResultPanel result={props.latestResult} compact />
        </div>
        <aside className={styles.boardLedger}>
          <PrizeLedger tierCounts={props.tierCounts} box={props.activeBox} />
          <LastOneCard compact />
        </aside>
      </section>
    </div>
  );
}

function VariantC(props: SharedVariantProps) {
  return (
    <div className={styles.variantContent}>
      <section className={styles.questLayout}>
        <div className={styles.questPoster}>
          <Image
            alt="홍실퀘스트 두 주인공 키아트"
            fill
            loading="eager"
            sizes="(max-width: 900px) 100vw, 25vw"
            src="/generated/ip/hong-sil-quest.webp"
          />
          <div className={styles.questPosterCopy}>
            <span>RED THREAD QUEST</span>
            <b>행운상점 특별 회차</b>
          </div>
        </div>
        <div className={styles.questJourney}>
          <div className={styles.questTitle}>
            <p className={styles.kicker}>FOLLOW THE RED THREAD</p>
            <h2>붉은 실을 따라<br />굿즈를 만나세요</h2>
            <p>각 지점은 한 박스에 들어 있는 정확한 상품 수량을 뜻합니다.</p>
            <a className={styles.jumpLink} href="#kuji-interaction">박스 체험으로 이동 <span aria-hidden>↓</span></a>
          </div>
          <PrizeCards tierCounts={props.tierCounts} mode="journey" />
          <LastOneCard />
        </div>
        <aside className={styles.questLedger}>
          <PrizeLedger tierCounts={props.tierCounts} box={props.activeBox} />
        </aside>
      </section>
      <section className={styles.questDock} id="kuji-interaction">
        <BoxPicker {...props} compact />
        <ControlPanel {...props} />
        <TicketGrid {...props} compact />
        <RevealAction {...props} />
      </section>
      <ResultPanel result={props.latestResult} />
    </div>
  );
}

function BoxPicker({
  boxes,
  activeBox,
  chooseBox,
  compact = false,
}: SharedVariantProps & { compact?: boolean }) {
  return (
    <section aria-labelledby="kuji-box-title" className={`${styles.panel} ${styles.boxPanel} ${compact ? styles.compactPanel : ''}`}>
      <div className={styles.panelTitle}>
        <span>1</span>
        <div><h3 id="kuji-box-title">박스 선택</h3><small>각 박스는 독립된 30개 구성입니다.</small></div>
      </div>
      <div className={styles.boxList}>
        {boxes.map((box) => {
          const count = availableCount(box);
          const selected = box.id === activeBox.id;
          return (
            <button
              aria-pressed={selected}
              className={styles.boxButton}
              data-active={selected ? 'true' : 'false'}
              disabled={count === 0}
              key={box.id}
              onClick={() => chooseBox(box.id)}
              type="button"
            >
              <span className={styles.boxIcon} aria-hidden><i /><i /><i /></span>
              <span><b>{box.label}</b><small>{box.note}</small></span>
              <span className={styles.boxCount}><b>{count}</b><small>/ 30</small></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TicketGrid({
  activeBox,
  selectedPositions,
  quantity,
  togglePosition,
  compact = false,
}: SharedVariantProps & { compact?: boolean }) {
  return (
    <section aria-labelledby="kuji-ticket-title" className={`${styles.panel} ${styles.ticketPanel} ${compact ? styles.compactPanel : ''}`}>
      <div className={styles.panelTitle}>
        <span>3</span>
        <div>
          <h3 id="kuji-ticket-title">봉인 번호 선택</h3>
          <small>원하는 위치를 {quantity}개 골라주세요.</small>
        </div>
        <em>{selectedPositions.length} / {quantity}</em>
      </div>
      <div className={styles.ticketLegend}>
        <span><i className={styles.availableSwatch} />선택 가능</span>
        <span><i className={styles.selectedSwatch} />선택됨</span>
        <span><i className={styles.soldSwatch} />이미 체험</span>
      </div>
      <div className={styles.ticketGrid}>
        {activeBox.tickets.map((ticket) => {
          const selected = selectedPositions.includes(ticket.position);
          const sold = ticket.status === 'sold';
          return (
            <button
              aria-label={`봉인 번호 ${ticket.position}${sold ? ', 이미 체험함' : selected ? ', 선택됨' : ', 선택 가능'}`}
              aria-pressed={selected}
              className={styles.ticket}
              data-selected={selected ? 'true' : 'false'}
              disabled={sold}
              key={ticket.position}
              onClick={() => togglePosition(ticket.position)}
              type="button"
            >
              {sold ? '×' : String(ticket.position).padStart(2, '0')}
            </button>
          );
        })}
      </div>
      <p className={styles.selectionNote}>번호 위치는 상품 등급이나 확률을 암시하지 않습니다.</p>
    </section>
  );
}

function ControlPanel({
  remaining,
  quantity,
  chooseQuantity,
}: SharedVariantProps) {
  const choices = Array.from(
    { length: Math.min(remaining, MAX_PER_ROUND) },
    (_, index) => index + 1,
  );
  return (
    <section aria-labelledby="kuji-quantity-title" className={`${styles.panel} ${styles.controlPanel}`}>
      <div className={styles.panelTitle}>
        <span>2</span>
        <div><h3 id="kuji-quantity-title">참여 수량</h3><small>한 번에 최대 {MAX_PER_ROUND}개</small></div>
      </div>
      {remaining > 0 ? (
        <div className={styles.quantityChoices}>
          {choices.map((choice) => (
            <button
              aria-pressed={choice === quantity}
              data-active={choice === quantity ? 'true' : 'false'}
              key={choice}
              onClick={() => chooseQuantity(choice)}
              type="button"
            >
              <b>{choice}회</b>
              <small>{choice === remaining && remaining !== 1 ? '남은 수량 전체' : `${formatPrice(choice * SAMPLE_UNIT_PRICE)}원`}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.emptyBox}>이 박스의 모든 굿즈를 확인했습니다.</p>
      )}
    </section>
  );
}

function RevealAction({
  remaining,
  quantity,
  selectedPositions,
  reveal,
}: SharedVariantProps) {
  const ready = quantity > 0 && selectedPositions.length === quantity;
  const buttonLabel = remaining === 0
    ? '이 박스의 굿즈를 모두 확인했어요'
    : ready
      ? `${quantity}개 결과 공개`
      : `번호 ${Math.max(quantity - selectedPositions.length, 0)}개 더 선택`;

  return (
    <section aria-label="선택 확인" className={`${styles.panel} ${styles.revealAction}`}>
      <div className={styles.panelTitle}>
        <span>4</span>
        <div><h3>결과 공개</h3><small>선택을 확인하고 굿즈를 공개합니다.</small></div>
      </div>
      <div className={styles.revealBody}>
        <dl className={styles.orderSummary}>
          <div><dt>선택한 번호</dt><dd>{selectedPositions.length > 0 ? selectedPositions.map((item) => String(item).padStart(2, '0')).join(', ') : '아직 없음'}</dd></div>
          <div><dt>프로토타입 기준 단가</dt><dd>1회 {formatPrice(SAMPLE_UNIT_PRICE)}원</dd></div>
          <div><dt>표시 금액</dt><dd>{formatPrice(quantity * SAMPLE_UNIT_PRICE)}원</dd></div>
        </dl>
        <button className={styles.revealButton} disabled={!ready} onClick={reveal} type="button">
          {buttonLabel}
          <span aria-hidden>→</span>
        </button>
        <p className={styles.noCharge}>실제 결제·주문·재고 반영·배송은 발생하지 않습니다.</p>
      </div>
    </section>
  );
}

function PrizeCards({ tierCounts, mode }: { tierCounts: Map<TierId, number>; mode: 'shelf' | 'journey' }) {
  return (
    <div className={mode === 'journey' ? styles.journeyGrid : styles.prizeGrid}>
      {PRIZES.map((prize) => (
        <article className={styles.prizeCard} key={prize.tier}>
          <div className={styles.prizeImage}>
            <Image alt={prize.name} fill loading="eager" sizes="(max-width: 760px) 46vw, 180px" src={prize.image} />
          </div>
          <div className={styles.prizeCopy}>
            <span>{prize.tier}상</span>
            <b>{prize.name}</b>
            <small>{prize.detail}</small>
            <em>남은 수량 <strong>{tierCounts.get(prize.tier) ?? 0}</strong> / {prize.initialCount}</em>
          </div>
        </article>
      ))}
    </div>
  );
}

function PrizeLedger({ tierCounts, box }: { tierCounts: Map<TierId, number>; box: BoxState }) {
  return (
    <section className={`${styles.panel} ${styles.ledgerPanel}`}>
      <div className={styles.ledgerTitle}>
        <div><span>{box.label}</span><b>남은 굿즈</b></div>
        <strong>{availableCount(box)} <small>/ 30</small></strong>
      </div>
      <div className={styles.ledgerList}>
        {PRIZES.map((prize) => (
          <div key={prize.tier}>
            <span className={styles.ledgerTier}>{prize.tier}</span>
            <span className={styles.ledgerThumb}><Image alt="" fill sizes="56px" src={prize.image} /></span>
            <span><b>{prize.name}</b><small>{prize.detail}</small></span>
            <strong>{tierCounts.get(prize.tier) ?? 0}<small> / {prize.initialCount}</small></strong>
          </div>
        ))}
      </div>
      <p className={styles.ledgerFoot}>이 수량은 현재 브라우저 메모리의 시뮬레이션 상태입니다.</p>
    </section>
  );
}

function LastOneCard({ compact = false }: { compact?: boolean }) {
  return (
    <article className={`${styles.lastOneCard} ${compact ? styles.lastOneCompact : ''}`}>
      <div className={styles.lastOneImage}>
        <Image
          alt="마지막 상 한정 붉은 실 데스크매트"
          fill
          sizes={compact ? '(max-width: 760px) 100vw, 260px' : '(max-width: 900px) 100vw, 32vw'}
          src="/generated/hong-sil-kuji/goods/last-one-desk-mat.webp"
        />
      </div>
      <div>
        <span>마지막 상</span>
        <b>한정 붉은 실 데스크매트</b>
        <p>한 박스의 마지막 남은 굿즈를 선택한 회차에 한 번만 추가됩니다.</p>
      </div>
    </article>
  );
}

function ResultPanel({ result, compact = false }: { result: RevealResult | null; compact?: boolean }) {
  return (
    <section className={`${styles.resultPanel} ${compact ? styles.resultCompact : ''}`} aria-live="polite">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>YOUR GOODS</p>
          <h2>이번에 받은 굿즈</h2>
        </div>
        <p>{result ? `${result.boxLabel} · ${result.id}번째 체험` : '봉인 번호를 선택하면 이곳에서 결과를 확인할 수 있어요.'}</p>
      </div>
      {result ? (
        <div className={styles.resultGrid}>
          {result.awards.map((award) => {
            const prize = PRIZE_BY_TIER.get(award.tier);
            if (!prize) return null;
            return (
              <article key={award.position}>
                <div><Image alt={prize.name} fill sizes="(max-width: 390px) calc(100vw - 68px), (max-width: 760px) 44vw, 240px" src={prize.image} /></div>
                <span>{award.tier}상 · 봉인 {String(award.position).padStart(2, '0')}</span>
                <b>{prize.name}</b>
              </article>
            );
          })}
          {result.lastOne ? (
            <article className={styles.lastOneResult}>
              <div><Image alt="마지막 상 한정 붉은 실 데스크매트" fill sizes="(max-width: 390px) calc(100vw - 68px), (max-width: 760px) 44vw, 240px" src="/generated/hong-sil-kuji/goods/last-one-desk-mat.webp" /></div>
              <span>마지막 상 · 추가 굿즈</span>
              <b>한정 붉은 실 데스크매트</b>
            </article>
          ) : null}
        </div>
      ) : (
        <div className={styles.resultPlaceholder}><span>?</span><p>결과 대기 중</p></div>
      )}
    </section>
  );
}

function SessionLedger({ history, boxes, onReset }: { history: RevealResult[]; boxes: BoxState[]; onReset: () => void }) {
  const received = new Map<TierId, number>(PRIZES.map((prize) => [prize.tier, 0]));
  let lastOneCount = 0;
  for (const result of history) {
    for (const award of result.awards) received.set(award.tier, (received.get(award.tier) ?? 0) + 1);
    if (result.lastOne) lastOneCount += 1;
  }

  return (
    <section className={styles.sessionLedger}>
      <div>
        <p className={styles.kicker}>VISIBLE PROTOTYPE STATE</p>
        <h2>현재 세션 상태</h2>
        <p>서버나 브라우저 저장소에 쓰지 않습니다. 새로고침 또는 초기화 시 모두 원래 상태로 돌아갑니다.</p>
      </div>
      <div className={styles.sessionStats}>
        {boxes.map((box) => <span key={box.id}><b>{box.label}</b>{availableCount(box)} / 30</span>)}
        <span><b>체험 회차</b>{history.length}회</span>
      </div>
      <div className={styles.receivedList}>
        {PRIZES.map((prize) => <span key={prize.tier}><b>{prize.tier}상</b>{received.get(prize.tier) ?? 0}개</span>)}
        <span><b>마지막 상</b>{lastOneCount}개</span>
      </div>
      <button type="button" onClick={onReset}>세션 초기화</button>
    </section>
  );
}

function VariantSwitcher({ active, onChange }: { active: Variant; onChange: (variant: Variant) => void }) {
  return (
    <nav aria-label="프로토타입 화면 전환" className={styles.variantSwitcher}>
      <div>
        {VARIANTS.map((variant) => (
          <button
            aria-label={`${variant} 화면 · ${VARIANT_DETAILS[variant].label} · ${VARIANT_DETAILS[variant].description}`}
            aria-current={active === variant ? 'page' : undefined}
            data-active={active === variant ? 'true' : 'false'}
            key={variant}
            onClick={() => onChange(variant)}
            type="button"
          >
            <span>{variant}</span>
            <span>
              <b>{VARIANT_DETAILS[variant].label}</b>
              <small>{VARIANT_DETAILS[variant].description}</small>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
