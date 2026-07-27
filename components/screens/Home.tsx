'use client';

import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Ip } from '@/lib/data';
import {
  getHomeSelectableIps,
  prioritizeHomePostPreviews,
  type HomeBanner,
  type HomeCurationSnapshot,
  type HomePostPreviewByIpId,
} from '@/lib/home-catalog';
import { RARITY_META } from '@/lib/rarity';
import { hrefFor } from '@/lib/routes';
import { useHeaderScrollHide } from '@/components/shell/useHeaderScrollHide';
import { Empty } from '@/components/ui/Empty';

const NAV_LINKS = [
  { label: 'IP', href: '/ip' },
  { label: '굿즈', href: '/shop' },
  { label: '카드', href: '/packs' },
  { label: '팝업', href: '/events' },
  { label: '커뮤니티', href: '/community' },
];

const HERO_ACCENTS = ['#f6d17d', '#c4e5ae', '#a6c5e6', '#ffdaff', '#ffe888'];
const HERO_ACCENT_BY_SLIDE_ID: Record<string, string> = {
  'ip-rilakkuma': '#f6d17d',
  'ip-maplestory': '#c4e5ae',
  'ip-attack-on-titan': '#a6c5e6',
  'event-e1': '#ffdaff',
  'ip-kakao-friends': '#ffe888',
};

const REFERENCE_FEATURED_IP_IDS = ['rilakkuma', 'maplestory', 'nongdamgom', 'kakao-friends', 'attack-on-titan'];
const PREVIEW_WEBP_ASSETS = new Set([
  '/generated/cards/c1.png',
  '/generated/cards/c11.png',
  '/generated/cards/c3.png',
  '/generated/cards/c6.png',
  '/generated/events/e1.png',
  '/generated/events/e2.png',
  '/generated/events/e4.png',
  '/generated/goods/g3.png',
  '/generated/goods/g4.png',
  '/generated/goods/g6.png',
  '/generated/goods/g9.png',
  '/generated/ip/attack-on-titan.png',
  '/generated/ip/kakao-friends.png',
  '/generated/ip/maplestory.png',
  '/generated/ip/nongdamgom.png',
  '/generated/ip/rilakkuma.png',
]);

const previewAssetBackground = (background: string) => background.replace(
  /\/generated\/(?:cards|events|goods|ip)\/[a-z0-9-]+\.png/g,
  (path) => PREVIEW_WEBP_ASSETS.has(path) ? `${path.slice(0, -4)}.webp` : path,
);

const PREVIEW_HERO_COPY: Record<string, {
  eyebrow: string;
  title: string;
  description: string;
}> = {
  rilakkuma: {
    eyebrow: 'ICONS ORIGINAL CURATION',
    title: '느긋한 하루를\n수집하는 시간',
    description: '리락쿠마의 포근한 방을 굿즈, 카드, 팝업으로 만나보세요.',
  },
  maplestory: {
    eyebrow: 'NEW IP WORLD',
    title: '몬스터즈가\n굿즈로 튀어나왔다',
    description: '주황버섯부터 핑크빈까지, 메이플스토리의 세계를 한곳에서.',
  },
  'attack-on-titan': {
    eyebrow: 'LIMITED EDITION',
    title: '리바이 에디션,\n고요한 전투의 기록',
    description: '진격의 거인 한정 굿즈와 디지털 카드를 먼저 만나보세요.',
  },
  'kakao-friends': {
    eyebrow: 'PICNIC COLLECTION',
    title: '좋아하는 친구들과\n피크닉을 떠나요',
    description: '라이언, 춘식이, 어피치가 함께하는 여름 컬렉션.',
  },
};

const compactNumber = (number: number) => new Intl.NumberFormat('ko-KR', {
  notation: 'compact',
  maximumFractionDigits: 1,
}).format(number);

const krw = (number: number) => `₩${number.toLocaleString('ko-KR')}`;

const subscribeReducedMotion = (onChange: () => void) => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

const getReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const getServerReducedMotion = () => false;

function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, getServerReducedMotion);
}

const subscribeDocumentHidden = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};

const getDocumentHidden = () => document.visibilityState === 'hidden';
const getServerDocumentHidden = () => false;

function useDocumentHidden() {
  return useSyncExternalStore(subscribeDocumentHidden, getDocumentHidden, getServerDocumentHidden);
}

function useRotatingIndex(count: number, delay: number, paused: boolean) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (paused || count <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, delay);
    return () => window.clearInterval(timer);
  }, [count, delay, paused]);

  return [count > 0 ? index % count : 0, setIndex] as const;
}

function Artwork({
  background,
  className = 'preview-artwork',
  label,
}: {
  background: string;
  className?: string;
  label?: string;
}) {
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
      role={label ? 'img' : undefined}
      style={{ background: previewAssetBackground(background) }}
    />
  );
}

function PreviewHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { hidden, reveal } = useHeaderScrollHide({ forceVisible: menuOpen });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menuButton = menuButtonRef.current;
    const backgroundElements = [
      document.querySelector<HTMLElement>('.icons-preview main'),
      document.querySelector<HTMLElement>('.icons-preview .site-footer'),
    ].filter((element): element is HTMLElement => Boolean(element));
    const previousInert = backgroundElements.map((element) => element.inert);
    document.body.style.overflow = 'hidden';
    backgroundElements.forEach((element) => {
      element.inert = true;
    });

    const getFocusable = () => [
      menuButton,
      ...Array.from(menuRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []),
    ].filter((element): element is HTMLElement => Boolean(element));

    getFocusable()[1]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      backgroundElements.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      (previousFocus ?? menuButton)?.focus();
    };
  }, [menuOpen]);

  return (
    <>
      <header className={`site-header ${hidden ? 'site-header--hidden' : ''}`}>
        <Link aria-label="ICONS 홈" className="brand" href="/">
          ICONS
        </Link>
        <nav aria-label="주요 메뉴" className="desktop-nav">
          {NAV_LINKS.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
        <Link className="header-cta" href="/ip">
          IP 둘러보기 <span aria-hidden>↗</span>
        </Link>
        <button
          ref={menuButtonRef}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? '메뉴 닫기' : '메뉴 열기'}
          className="menu-toggle"
          onClick={() => {
            reveal();
            setMenuOpen((open) => !open);
          }}
          type="button"
        >
          <span /><span />
        </button>
      </header>
      <div
        ref={menuRef}
        aria-label="전체 메뉴"
        aria-hidden={!menuOpen}
        aria-modal={menuOpen ? true : undefined}
        className={`mobile-menu ${menuOpen ? 'mobile-menu--open' : ''}`}
        inert={menuOpen ? undefined : true}
        role={menuOpen ? 'dialog' : undefined}
      >
        <div className="mobile-menu__top"><span>ICONS MENU</span><span>SEOUL · 2026</span></div>
        <nav aria-label="모바일 메뉴">
          {NAV_LINKS.map((item, index) => (
            <Link href={item.href} key={item.href} onClick={() => setMenuOpen(false)} tabIndex={menuOpen ? undefined : -1}>
              <small>{String(index + 1).padStart(2, '0')}</small>{item.label}<span aria-hidden>↗</span>
            </Link>
          ))}
        </nav>
        <p>좋아하는 세계를 발견하고, 사고, 모으고, 만나고, 함께 이야기하세요.</p>
      </div>
    </>
  );
}

interface HeroSlide {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  background: string;
  href: string;
  label: string;
}

function heroSlidesFor({
  catalog,
  curatedHero,
  selectedIp,
  selectableIps,
}: {
  catalog: CatalogSnapshot;
  curatedHero: HomeBanner | null;
  selectedIp: Ip | null;
  selectableIps: Ip[];
}) {
  const slides: HeroSlide[] = [];
  const seen = new Set<string>();
  const push = (slide: HeroSlide) => {
    if (slides.length >= 5 || seen.has(slide.id)) return;
    seen.add(slide.id);
    slides.push(slide);
  };
  const pushIp = (ip: Ip, fallbackEyebrow: string) => {
    const previewCopy = PREVIEW_HERO_COPY[ip.id];
    push({
      id: `ip-${ip.id}`,
      eyebrow: previewCopy?.eyebrow ?? fallbackEyebrow,
      title: previewCopy?.title ?? ip.tagline,
      description: previewCopy?.description ?? ip.synopsis,
      background: ip.bg,
      href: hrefFor('ip', ip.id),
      label: ip.title,
    });
  };

  if (curatedHero) {
    push({
      id: `curation-${curatedHero.id}`,
      eyebrow: 'FEATURED STORY',
      title: curatedHero.title,
      description: '지금 ICONS에서 가장 먼저 만나볼 수 있는 새로운 IP 경험입니다.',
      background: curatedHero.imageBg ?? selectedIp?.bg ?? 'var(--editorial-placeholder)',
      href: curatedHero.href,
      label: curatedHero.title,
    });
  }

  const previewOrder = ['rilakkuma', 'maplestory', 'attack-on-titan'];
  const previewIps = previewOrder
    .map((id) => catalog.ips.find((ip) => ip.id === id))
    .filter((ip): ip is Ip => Boolean(ip));
  const previewEvent = catalog.events.find((event) => event.id === 'e1');
  const previewKakao = catalog.ips.find((ip) => ip.id === 'kakao-friends');
  const hasReferenceFeaturedOrder = selectableIps.length === REFERENCE_FEATURED_IP_IDS.length
    && selectableIps.every((ip, index) => ip.id === REFERENCE_FEATURED_IP_IDS[index]);
  const hasPreviewSet = hasReferenceFeaturedOrder
    && previewIps.length === 3
    && Boolean(previewEvent && previewKakao);

  if (hasPreviewSet) {
    for (const ip of previewIps) {
      const copy = PREVIEW_HERO_COPY[ip.id];
      push({
        id: `ip-${ip.id}`,
        eyebrow: copy.eyebrow,
        title: copy.title,
        description: copy.description,
        background: ip.bg,
        href: hrefFor('ip', ip.id),
        label: ip.title,
      });
    }
    if (previewEvent) {
      push({
        id: `event-${previewEvent.id}`,
        eyebrow: 'POP-UP NOW',
        title: '포근한 방이\n성수에 열렸어요',
        description: '리락쿠마 팝업의 한정 굿즈와 현장 경험을 확인하세요.',
        background: previewEvent.img,
        href: `/events/${previewEvent.id}`,
        label: '리락쿠마 팝업',
      });
    }
    if (previewKakao) {
      const copy = PREVIEW_HERO_COPY[previewKakao.id];
      push({
        id: `ip-${previewKakao.id}`,
        eyebrow: copy.eyebrow,
        title: copy.title,
        description: copy.description,
        background: previewKakao.bg,
        href: hrefFor('ip', previewKakao.id),
        label: previewKakao.title,
      });
    }
    return slides;
  }

  if (selectedIp) {
    pushIp(selectedIp, 'YOUR IP, YOUR WORLD');
  }

  for (const event of catalog.events) {
    if (event.status !== '예매중' && event.status !== '진행중') continue;
    push({
      id: `event-${event.id}`,
      eyebrow: `${event.mode} · ${event.status}`,
      title: event.title,
      description: `${event.date} · ${event.loc}`,
      background: event.img,
      href: `/events/${event.id}`,
      label: event.title,
    });
  }

  for (const ip of selectableIps) {
    pushIp(ip, ip.sub);
  }

  return slides;
}

function HeroCarousel({
  catalog,
  curatedHero,
  selectedIp,
  selectableIps,
}: {
  catalog: CatalogSnapshot;
  curatedHero: HomeBanner | null;
  selectedIp: Ip | null;
  selectableIps: Ip[];
}) {
  const reducedMotion = useReducedMotion();
  const documentHidden = useDocumentHidden();
  const [userPaused, setUserPaused] = useState(false);
  const slides = useMemo(
    () => heroSlidesFor({ catalog, curatedHero, selectedIp, selectableIps }),
    [catalog, curatedHero, selectedIp, selectableIps],
  );
  const paused = userPaused || reducedMotion || documentHidden;
  const [activeIndex, setActiveIndex] = useRotatingIndex(slides.length, 3000, paused);
  const activeSlide = slides[activeIndex];

  if (!activeSlide) return null;

  return (
    <section aria-label="ICONS 주요 소식" aria-roledescription="carousel" className="hero">
      <div className="hero-slides">
        {slides.map((slide, index) => (
          <div
            aria-hidden={index !== activeIndex}
            className={`hero-slide ${index === activeIndex ? 'hero-slide--active' : ''}`}
            key={slide.id}
          >
            <Artwork background={slide.background} />
            <div className="hero-shade" />
          </div>
        ))}
      </div>
      <Link
        aria-label={`모바일에서 ${activeSlide.label} 열기`}
        className="hero-mobile-hit"
        href={activeSlide.href}
      />
      <div className="hero-copy" key={activeSlide.id}>
        <p className="eyebrow">{activeSlide.eyebrow}</p>
        <h1>
          {activeSlide.title.includes('\n')
            ? activeSlide.title.split('\n').map((line) => <span key={line}>{line}</span>)
            : activeSlide.title}
        </h1>
        <p className="hero-description">{activeSlide.description}</p>
        <Link aria-label={`${activeSlide.label} 자세히 보기`} className="round-link" href={activeSlide.href}>
          <span>VIEW</span><b aria-hidden>↗</b>
        </Link>
      </div>
      <div className="hero-controls">
        <button
          aria-label={userPaused ? '슬라이드 재생' : '슬라이드 일시 정지'}
          className="pause-button"
          onClick={() => setUserPaused((value) => !value)}
          type="button"
        >
          {userPaused ? '▶' : 'Ⅱ'}
        </button>
        <div className="hero-bullets">
          {slides.map((slide, index) => (
            <button
              aria-label={`${index + 1}번 슬라이드: ${slide.label}`}
              className={index === activeIndex ? 'active' : ''}
              key={slide.id}
              onClick={() => setActiveIndex(index)}
              type="button"
            >
              <span style={{ backgroundColor: HERO_ACCENT_BY_SLIDE_ID[slide.id] ?? HERO_ACCENTS[index] }} />
            </button>
          ))}
        </div>
        <span className="hero-count">
          {String(activeIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
        </span>
      </div>
    </section>
  );
}

function AnnouncementBanner({
  announcement,
  dateLabel,
}: {
  announcement: HomeBanner;
  dateLabel: string;
}) {
  return (
    <aside aria-label="공지">
      <Link className="announcement" href={announcement.href} style={{ background: announcement.imageBg ?? undefined }}>
        <span className="announcement-label">NOTICE</span>
        <strong>{announcement.title}</strong>
        <span className="announcement-date">{dateLabel}</span>
        <span aria-hidden className="announcement-arrow">↗</span>
      </Link>
    </aside>
  );
}

function IpWorlds({ ips }: { ips: Ip[] }) {
  const shapes = ['round', 'hex', 'square', 'round', 'hex'];
  const renderGroup = (duplicate: boolean) => (
    <div className="marquee-group" aria-hidden={duplicate}>
      {ips.map((ip, index) => (
        <Link
          aria-label={duplicate ? undefined : `${ip.title} 세계 보기`}
          className={`ip-orbit ip-orbit--${shapes[index % shapes.length]}`}
          href={hrefFor('ip', ip.id)}
          key={`${duplicate ? 'copy' : 'main'}-${ip.id}`}
          tabIndex={duplicate ? -1 : undefined}
        >
          <Artwork background={ip.bg} label={duplicate ? undefined : `${ip.title} 키아트`} />
          <span className="ip-overlay">
            <small>{compactNumber(ip.fans)} FANS</small>
            <strong>{ip.title}</strong>
            <b>EXPLORE ↗</b>
          </span>
        </Link>
      ))}
    </div>
  );

  return (
    <section className="ip-section" id="ip">
      <div className="section-intro section-intro--center">
        <p className="eyebrow dark">ICONS IP</p>
        <h2>당신이 좋아하는<br />세계들을 만나보세요.</h2>
      </div>
      <div className="marquee-shell">
        <div className="marquee-track">
          {renderGroup(false)}
          {renderGroup(true)}
        </div>
      </div>
      <p className="section-footnote">CHARACTER IP · GAME · ANIMATION</p>
    </section>
  );
}

interface FilmScene {
  id: string;
  controlLabel: string;
  kicker: string;
  title: string;
  detail: string;
  background: string;
  color: string;
}

function FilmWindow({ scenes }: { scenes: FilmScene[] }) {
  const reducedMotion = useReducedMotion();
  const hidden = useDocumentHidden();
  const [userPaused, setUserPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const pointerInteractionRef = useRef(false);
  useEffect(() => {
    const clearPointerInteraction = () => { pointerInteractionRef.current = false; };
    window.addEventListener('pointerup', clearPointerInteraction);
    window.addEventListener('pointercancel', clearPointerInteraction);
    return () => {
      window.removeEventListener('pointerup', clearPointerInteraction);
      window.removeEventListener('pointercancel', clearPointerInteraction);
    };
  }, []);
  const [activeIndex, setActiveIndex] = useRotatingIndex(scenes.length, 4200, userPaused || reducedMotion || hidden || hoverPaused);
  const active = scenes[activeIndex];
  if (!active) return null;

  return (
    <section aria-label="ICONS 경험 소개" aria-roledescription="carousel" className="film-section">
      <div
        className="film-window"
        onFocusCapture={(event) => {
          if (!pointerInteractionRef.current && !event.currentTarget.contains(event.relatedTarget)) {
            setUserPaused(true);
          }
        }}
        onMouseEnter={() => setHoverPaused(true)}
        onMouseLeave={() => setHoverPaused(false)}
        onPointerDownCapture={() => { pointerInteractionRef.current = true; }}
      >
        <div className="film-visual" key={active.id}>
          <Artwork background={active.background} className="preview-artwork film-artwork" />
          <div className="film-tint" style={{ backgroundColor: active.color }} />
          <div aria-hidden="true" className="film-copy">
            <p>{active.kicker}</p>
            <h2>{active.title.split('\n').map((line) => <span key={line}>{line}</span>)}</h2>
            <strong>{active.detail}</strong>
          </div>
        </div>
        <div aria-atomic="true" aria-live={userPaused ? 'polite' : 'off'} className="sr-only">
          <p>{active.kicker}</p>
          <h2>{active.title.replace('\n', ' ')}</h2>
          <p>{active.detail}</p>
        </div>
        {scenes.length > 1 && (
          <div aria-label="필름 장면 선택 및 자동 전환" className="film-progress" role="group">
            {scenes.map((scene, index) => (
              <button
                aria-label={index === activeIndex
                  ? `${scene.controlLabel} 장면 자동 전환 ${userPaused ? '재개' : '일시 정지'}`
                  : `${scene.controlLabel} 장면 보기 및 자동 전환 일시 정지`}
                aria-pressed={index === activeIndex}
                className={index === activeIndex ? 'active' : ''}
                key={scene.id}
                onClick={() => {
                  if (index === activeIndex) {
                    setHoverPaused(false);
                    setUserPaused((paused) => !paused);
                  } else {
                    setActiveIndex(index);
                    setUserPaused(true);
                  }
                }}
                type="button"
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface ExperienceItem {
  id: string;
  tag: string;
  title: string;
  meta: string;
  background: string;
  href: string;
}

function Experiences({ items }: { items: ExperienceItem[] }) {
  const reducedMotion = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const scroll = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('.experience-card');
    track.scrollBy({
      left: direction * ((card?.offsetWidth ?? 320) + 28),
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  return (
    <section className="experience-section" id="experience">
      <div className="section-heading-row">
        <div><p className="eyebrow dark">RIGHT NOW AT ICONS</p><h2>지금 열려 있는<br />팬 경험</h2></div>
        <div className="carousel-buttons">
          <button aria-label="이전 경험" onClick={() => scroll(-1)} type="button">←</button>
          <button aria-label="다음 경험" onClick={() => scroll(1)} type="button">→</button>
        </div>
      </div>
      <div className="experience-track" ref={trackRef}>
        {items.length === 0 && (
          <div className="experience-empty">
            <strong>아직 열려 있는 경험이 없습니다</strong>
            <span>새 굿즈와 이벤트가 공개되면 이곳에서 바로 만날 수 있어요.</span>
            <Link href="/ip">다른 IP 둘러보기 ↗</Link>
          </div>
        )}
        {items.map((item, index) => (
          <Link className="experience-card" href={item.href} key={item.id}>
            <div className="experience-image">
              <Artwork background={item.background} />
              <span>{String(index + 1).padStart(2, '0')}</span>
            </div>
            <div className="experience-copy">
              <small>{item.tag}</small><h3>{item.title}</h3><p>{item.meta}</p><b aria-hidden>↗</b>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function useFeatureParallax(disabled: boolean) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (disabled) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const root = ref.current;
      if (!root) return;
      root.querySelectorAll<HTMLElement>('[data-parallax="true"]').forEach((element) => {
        const featureArt = element.parentElement;
        if (!featureArt) return;
        const rect = featureArt.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / (window.innerHeight + rect.height)));
        const start = Number(element.dataset.start ?? 0);
        const end = Number(element.dataset.end ?? 0);
        element.style.transform = `translate3d(0, ${start + ((end - start) * progress)}px, 0)`;
      });
    };
    const onScroll = () => {
      if (frame === null) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [disabled]);

  return ref;
}

function WorldFeatures({
  catalog,
  followedIpIdSet,
  orderedIpIds,
  selectedIp,
  postPreviewByIpId,
}: {
  catalog: CatalogSnapshot;
  followedIpIdSet: ReadonlySet<string>;
  orderedIpIds: readonly string[];
  selectedIp: Ip;
  postPreviewByIpId: HomePostPreviewByIpId;
}) {
  const reducedMotion = useReducedMotion();
  const ref = useFeatureParallax(reducedMotion);
  const worldIp = catalog.ips.find((ip) => ip.id === 'maplestory') ?? selectedIp;
  const worldGood = catalog.goods.find((good) => good.id === 'g4')
    ?? catalog.goods.find((good) => good.ip === worldIp.id);
  const worldCard = catalog.cards.find((card) => card.id === 'c3')
    ?? catalog.cards.find((card) => card.ip === worldIp.id);
  const communityEvent = catalog.events.find((event) => event.id === 'e1')
    ?? catalog.events.find((event) => event.ip === selectedIp.id);
  const posts = prioritizeHomePostPreviews(postPreviewByIpId, followedIpIdSet, orderedIpIds)
    .map(([, post]) => post);
  const primaryPost = posts[0];
  const secondaryPost = posts.find((post) => post.id !== primaryPost?.id);
  const featureCards = ['c1', 'c6', 'c11']
    .map((id) => catalog.cards.find((card) => card.id === id))
    .filter((card): card is CatalogSnapshot['cards'][number] => Boolean(card));
  const cardBackgrounds = [0, 1, 2].map((index) => featureCards[index]?.bg ?? catalog.cards[index]?.bg ?? selectedIp.bg);

  return (
    <section className="world-section" id="world" ref={ref}>
      <div className="section-intro section-intro--center world-intro">
        <p className="eyebrow dark">YOUR FANDOM, YOUR WAY</p>
        <h2>사고, 모으고, 만나고,<br />떠드는 모든 순간을 한곳에서.</h2>
      </div>

      <article className="feature feature--green">
        <div className="feature-copy">
          <span className="feature-number">01</span><p className="eyebrow dark">ONE IP, ONE WORLD</p>
          <h3>하나의 IP,<br />하나로 이어진 세계</h3>
          <p>좋아하는 IP를 고르면 굿즈, 카드, 팝업, 커뮤니티가 한 화면에서 연결됩니다.</p>
          <Link href={hrefFor('ip', worldIp.id)}>IP 세계로 들어가기 <span aria-hidden>↗</span></Link>
        </div>
        <div className="feature-art feature-art--world">
          <div className="world-poster feature-float" data-end="-35" data-parallax="true" data-start="5">
            <Artwork background={worldIp.bg} label={`${worldIp.title} 키아트`} />
          </div>
          <div className="world-card world-card--one feature-float" data-end="7" data-parallax="true" data-start="-45">
            <Artwork background={worldGood?.img ?? worldIp.bg} label={worldGood?.name ?? `${worldIp.title} 굿즈`} /><span>GOODS</span>
          </div>
          <div className="world-card world-card--two feature-float" data-end="40" data-parallax="true" data-start="-58">
            <Artwork background={worldCard?.bg ?? worldIp.bg} label={worldCard?.name ?? `${worldIp.title} 카드`} /><span>SSR CARD</span>
          </div>
          <div className="world-chip">FOLLOWING · FREE</div>
        </div>
      </article>

      <article className="feature feature--pink" id="community">
        <div className="feature-copy">
          <span className="feature-number">02</span><p className="eyebrow dark">SINCERE CONNECTION</p>
          <h3>좋아하는 사람들과<br />더 가까이</h3>
          <p>무료로 팬덤에 가입하고, 드롭과 팝업 소식을 가장 먼저 만나고, 같은 취향의 팬들과 이야기하세요.</p>
          <Link href="/community">팬덤 발견하기 <span aria-hidden>↗</span></Link>
        </div>
        <div className="feature-art feature-art--community">
          <div className="chat-card chat-card--one feature-float" data-end="-20" data-parallax="true" data-start="5">
            <span className="avatar avatar--yellow">R</span>
            <p><b>{primaryPost?.user ?? 'relax_room'}</b><br />{primaryPost?.text ?? '낮잠 쿠션 실물감 너무 좋아요!'}</p>
            <small>♥ {primaryPost?.likes ?? 342}</small>
          </div>
          <div className="chat-photo feature-float" data-end="-52" data-parallax="true" data-start="5">
            <Artwork background={communityEvent?.img ?? selectedIp.bg} label={communityEvent?.title ?? `${selectedIp.title} 팝업`} />
          </div>
          <div className="chat-card chat-card--two feature-float" data-end="30" data-parallax="true" data-start="-42">
            <span className="avatar avatar--green">M</span>
            <p><b>{secondaryPost?.user ?? 'mushroom_jump'}</b><br />{secondaryPost?.text ?? '몬스터 키링 4종 같이 샀어요.'}</p>
            <small>♥ {secondaryPost?.likes ?? 218}</small>
          </div>
          <div aria-hidden className="community-heart">♥</div>
        </div>
      </article>

      <article className="feature feature--blue">
        <div className="feature-copy">
          <span className="feature-number">03</span><p className="eyebrow dark">COLLECT THE MOMENT</p>
          <h3>갖는 순간부터<br />기록되는 카드</h3>
          <p>굿즈 주문과 참여 경험으로 받은 무료 카드팩을 열고, 소중한 장면을 바인더에 모아보세요.</p>
          <Link href="/packs">카드 경험 보기 <span aria-hidden>↗</span></Link>
        </div>
        <div className="feature-art feature-art--cards">
          <div className="collect-card collect-card--back feature-float" data-end="25" data-parallax="true" data-start="-18"><Artwork background={cardBackgrounds[0]} /></div>
          <div className="collect-card collect-card--middle feature-float" data-end="-32" data-parallax="true" data-start="18"><Artwork background={cardBackgrounds[1]} /></div>
          <div className="collect-card collect-card--front feature-float" data-end="12" data-parallax="true" data-start="-8"><Artwork background={cardBackgrounds[2]} /><span>HOLO</span></div>
          <div className="card-pack">CARD PACK<br /><b>FREE REWARD</b></div>
        </div>
      </article>
    </section>
  );
}

function Stats({ catalog }: { catalog: CatalogSnapshot }) {
  const fans = catalog.ips.reduce((total, ip) => total + ip.fans, 0);
  const activeEvents = catalog.events.filter((event) => event.status === '예매중' || event.status === '진행중').length;
  const stats = [
    [String(catalog.ips.length), '함께하는 IP'],
    [String(catalog.goods.length), '공식 라이선스 굿즈'],
    [String(catalog.cards.length), '수집형 디지털 카드'],
    [String(activeEvents), '열려 있는 팝업'],
    [compactNumber(fans), catalog.source === 'mock' ? '샘플 연결 팬' : '연결된 팬'],
    ['FREE', '무료 팬덤 가입'],
  ];

  return (
    <section className="trust-section">
      <div className="trust-title"><p className="eyebrow dark">ICONS IN NUMBERS</p><h2>좋아하는 마음이<br />모이는 곳</h2></div>
      <div className="stats-grid">
        {stats.map(([value, label], index) => (
          <div className={`stat stat--${index + 1}`} key={label}><strong>{value}</strong><span>{label}</span></div>
        ))}
      </div>
      <p className="trust-note">공식 라이선스 굿즈 · 무상 카드 리워드 · 공개 IP 브라우징</p>
    </section>
  );
}

function FinalCta({ ips }: { ips: Ip[] }) {
  const first = ips.find((ip) => ip.id === 'nongdamgom') ?? ips[0];
  const second = ips.find((ip) => ip.id === 'kakao-friends') ?? ips[1] ?? ips[0];
  return (
    <section className="final-cta" id="final">
      <p className="eyebrow dark">START YOUR FANDOM</p>
      <h2>당신의 최애가<br />기다리고 있어요.</h2>
      <Link href="/ip"><span>IP 둘러보기</span><b aria-hidden>↗</b></Link>
      {first && <div className="final-orbit final-orbit--one"><Artwork background={first.bg} /></div>}
      {second && <div className="final-orbit final-orbit--two"><Artwork background={second.bg} /></div>}
    </section>
  );
}

function PreviewFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <Link className="footer-brand" href="/">ICONS<span>·</span></Link>
        <p>모든 팬의 세계가<br />하나로 이어지는 곳.</p>
      </div>
      <div className="footer-links">
        <div><small>EXPLORE</small><Link href="/ip">IP</Link><Link href="/shop">굿즈</Link><Link href="/events">팝업</Link></div>
        <div><small>COMMUNITY</small><Link href="/community">커뮤니티</Link><Link href="/packs">카드</Link><Link href="/login">팬덤 가입</Link></div>
        <div><small>SOCIAL</small><a href="#top">Instagram ↗</a><a href="#top">YouTube ↗</a><a href="#top">X ↗</a></div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 ICONS. ALL RIGHTS RESERVED.</span><span>SEOUL, KOREA · 37.5665° N</span><a href="#top">BACK TO TOP ↑</a>
      </div>
    </footer>
  );
}

export function Home({
  catalog,
  curation,
  followedIpIds,
  postPreviewByIpId,
}: {
  catalog: CatalogSnapshot;
  curation: HomeCurationSnapshot;
  followedIpIds: string[];
  postPreviewByIpId: HomePostPreviewByIpId;
}) {
  const selectableIps = useMemo(
    () => getHomeSelectableIps(catalog, catalog.source === 'mock' ? undefined : curation.featuredIpIds),
    [catalog, curation.featuredIpIds],
  );
  const selectableIpIds = useMemo(() => selectableIps.map((ip) => ip.id), [selectableIps]);
  const followedIpIdSet = useMemo(() => new Set(followedIpIds), [followedIpIds]);
  const selectedIp = selectableIps[0] ?? null;
  const hasPreviewDataset = REFERENCE_FEATURED_IP_IDS
    .every((id) => catalog.ips.some((ip) => ip.id === id));

  const announcement = useMemo<HomeBanner | null>(() => {
    if (curation.announcement) return curation.announcement;
    const event = hasPreviewDataset ? catalog.events.find((item) => item.id === 'e2') : null;
    if (event) return {
      id: `event-${event.id}`,
      title: '메이플스토리 몬스터즈 온라인 팝업 예매가 열렸어요.',
      imageBg: null,
      href: `/events/${event.id}`,
    };
    return selectedIp ? {
      id: `ip-${selectedIp.id}`,
      title: `${selectedIp.title} 세계의 새로운 소식을 확인하세요.`,
      imageBg: null,
      href: hrefFor('ip', selectedIp.id),
    } : null;
  }, [catalog.events, curation.announcement, hasPreviewDataset, selectedIp]);
  const announcementDateLabel = curation.announcement === null && announcement?.id === 'event-e2'
    ? '2026.07.12'
    : '';

  const filmScenes = useMemo<FilmScene[]>(() => {
    const scenes: FilmScene[] = [];
    const preferredGood = hasPreviewDataset ? catalog.goods.find((item) => item.id === 'g3') : null;
    const preferredEvent = hasPreviewDataset ? catalog.events.find((item) => item.id === 'e4') : null;
    const preferredCard = hasPreviewDataset ? catalog.cards.find((item) => item.id === 'c11') : null;
    const good = preferredGood ?? (selectedIp ? catalog.goods.find((item) => item.ip === selectedIp.id) : null);
    const event = preferredEvent ?? (selectedIp ? catalog.events.find((item) => item.ip === selectedIp.id) : null);
    const card = preferredCard ?? (selectedIp ? catalog.cards.find((item) => item.ip === selectedIp.id) : null);
    if (good) scenes.push({ id: `good-${good.id}`, controlLabel: '굿즈', kicker: 'OFFICIAL GOODS', title: '좋아하는 마음이\n손에 잡히는 순간', detail: `${good.name} · ${good.badge ?? 'OFFICIAL'}`, background: good.img, color: '#c4e5ae' });
    if (event) scenes.push({ id: `event-${event.id}`, controlLabel: '팝업', kicker: 'POP-UP EXPERIENCE', title: '화면 너머의 세계를\n직접 만나는 하루', detail: `${event.title} · ${event.status}`, background: event.img, color: '#ffdaff' });
    if (card) scenes.push({ id: `card-${card.id}`, controlLabel: '카드', kicker: 'DIGITAL CARD', title: '모으는 재미까지\n하나의 IP 안에서', detail: `${card.name} · ${card.rarity}`, background: card.bg, color: '#a6c5e6' });
    if (scenes.length === 0 && selectedIp) scenes.push({ id: `ip-${selectedIp.id}`, controlLabel: 'IP', kicker: 'ONE IP, ONE WORLD', title: selectedIp.tagline, detail: selectedIp.title, background: selectedIp.bg, color: '#c4e5ae' });
    return scenes;
  }, [catalog.cards, catalog.events, catalog.goods, hasPreviewDataset, selectedIp]);

  const experiences = useMemo<ExperienceItem[]>(() => {
    const items: ExperienceItem[] = [];
    const addEvent = (id: string, tag?: string) => {
      const event = catalog.events.find((item) => item.id === id);
      if (event) items.push({ id: `event-${event.id}`, tag: tag ?? event.mode, title: event.title, meta: `${event.loc} · ${event.status}`, background: event.img, href: `/events/${event.id}` });
    };
    const addGood = (id: string, meta?: string) => {
      const good = catalog.goods.find((item) => item.id === id);
      if (good) items.push({ id: `good-${good.id}`, tag: 'GOODS', title: good.name, meta: meta ?? `${good.badge ?? good.type} · ${krw(good.price)}`, background: good.img, href: '/shop' });
    };
    const addCard = (id: string) => {
      const card = catalog.cards.find((item) => item.id === id);
      if (card) items.push({ id: `card-${card.id}`, tag: 'CARD', title: card.name, meta: `${RARITY_META[card.rarity].label} · ${card.no}`, background: card.bg, href: '/packs' });
    };

    if (hasPreviewDataset) {
      addEvent('e1', 'POP-UP');
      addGood('g9', '한정 · 재고 8개');
      addCard('c3');
      addEvent('e2', 'ONLINE POP-UP');
      addGood('g6', '신상 · 공식 라이선스');
      return items;
    }

    if (!selectedIp) return items;
    const good = catalog.goods.find((item) => item.ip === selectedIp.id);
    const event = catalog.events.find((item) => item.ip === selectedIp.id);
    const card = catalog.cards.find((item) => item.ip === selectedIp.id);
    if (good) items.push({ id: `good-${good.id}`, tag: good.badge ?? 'GOODS', title: good.name, meta: `${krw(good.price)} · ${good.type}`, background: good.img, href: '/shop' });
    if (event) items.push({ id: `event-${event.id}`, tag: `${event.mode} · ${event.status}`, title: event.title, meta: `${event.date} · ${event.loc}`, background: event.img, href: `/events/${event.id}` });
    if (card) items.push({ id: `card-${card.id}`, tag: `${card.rarity} · CARD`, title: card.name, meta: `${RARITY_META[card.rarity].label} · ${card.no}`, background: card.bg, href: '/packs' });
    return items;
  }, [catalog.cards, catalog.events, catalog.goods, hasPreviewDataset, selectedIp]);

  return (
    <div className="icons-preview">
      <PreviewHeader />
      <main id="top">
        {(selectedIp || curation.hero) && (
          <HeroCarousel catalog={catalog} curatedHero={curation.hero} selectedIp={selectedIp} selectableIps={selectableIps} />
        )}
        {announcement && <AnnouncementBanner announcement={announcement} dateLabel={announcementDateLabel} />}
        {selectedIp ? (
          <>
            <IpWorlds ips={selectableIps} />
            <FilmWindow scenes={filmScenes} />
            <Experiences items={experiences} />
            <WorldFeatures
              catalog={catalog}
              followedIpIdSet={followedIpIdSet}
              orderedIpIds={selectableIpIds}
              postPreviewByIpId={postPreviewByIpId}
              selectedIp={selectedIp}
            />
            <Stats catalog={catalog} />
            <FinalCta ips={catalog.ips} />
          </>
        ) : (
          <section className="preview-empty">
            <Empty icon="ip" text="등록된 IP가 아직 없습니다" sub="곧 새로운 IP가 공개될 예정이에요." />
            <Link href="/ip">IP 공개 소식 확인하기 ↗</Link>
          </section>
        )}
      </main>
      <PreviewFooter />
    </div>
  );
}
