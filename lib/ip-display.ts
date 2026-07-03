/* 디자인 핸드오프의 IP별 표시 메타(영문명·액센트 색).
   카탈로그(Supabase/mock)에 없는 필드라 여기서 관리하고, 미등재 IP는 버티컬 색·타이틀로 fallback. */
import type { Ip } from './data';

const META: Record<string, { en: string; accent: string }> = {
  rilakkuma: { en: 'RILAKKUMA', accent: '#FFD84D' },
  maplestory: { en: 'MAPLESTORY', accent: '#38F0C0' },
  nongdamgom: { en: 'NONGDAMGOM', accent: '#F7A8C7' },
  'kakao-friends': { en: 'KAKAO FRIENDS', accent: '#FFD84D' },
  'attack-on-titan': { en: 'ATTACK ON TITAN', accent: '#A981FF' },
};

export const ipAccent = (ip: Pick<Ip, 'id' | 'v'>): string => META[ip.id]?.accent ?? ip.v.color;
export const ipEn = (ip: Pick<Ip, 'id' | 'title'>): string => META[ip.id]?.en ?? ip.title;
