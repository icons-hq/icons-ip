/* 디자인 핸드오프의 IP별 표시 메타(영문명·액센트 색).
   카탈로그(Supabase/mock)에 없는 필드라 여기서 관리하고, 미등재 IP는 버티컬 색·타이틀로 fallback. */
import type { Ip } from './data';

/* accent는 다크 표면 전제의 브랜드 색이라 라이트 배경 위 텍스트로 쓰면 대비가 무너진다.
   ink는 색상·채도를 유지한 채 명도만 낮춰 흰 배경과 캔버스 양쪽에서 WCAG AA(4.5:1)를 넘긴 값이다. */
const META: Record<string, { en: string; accent: string; ink: string }> = {
  rilakkuma: { en: 'RILAKKUMA', accent: '#FFD84D', ink: '#8A6C00' },
  maplestory: { en: 'MAPLESTORY', accent: '#38F0C0', ink: '#097E60' },
  nongdamgom: { en: 'NONGDAMGOM', accent: '#F7A8C7', ink: '#D91461' },
  'kakao-friends': { en: 'KAKAO FRIENDS', accent: '#FFD84D', ink: '#8A6C00' },
  'attack-on-titan': { en: 'ATTACK ON TITAN', accent: '#A981FF', ink: '#7F44FF' },
};

/** 테두리·글로우·배경 틴트 등 장식용 브랜드 색. 대비를 보장하지 않는다. */
export const ipAccent = (ip: Pick<Ip, 'id' | 'v'>): string => META[ip.id]?.accent ?? ip.v.color;
/** 라이트 표면 위 텍스트용 브랜드 색. 미등재 IP는 대비가 보장된 중립 잉크로 떨어뜨린다. */
export const ipAccentInk = (ip: Pick<Ip, 'id'>): string => META[ip.id]?.ink ?? 'var(--editorial-ink-muted)';
export const ipEn = (ip: Pick<Ip, 'id' | 'title'>): string => META[ip.id]?.en ?? ip.title;
