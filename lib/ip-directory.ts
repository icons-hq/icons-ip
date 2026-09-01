/* 온라인 팝업 디렉토리(/ip)의 A–Z 인덱스 분류 — R-03 §3.
 * 클라이언트 컴포넌트가 직접 임포트하는 순수 모듈이라 server-only 의존을 두지 않는다. */
import type { Ip } from './data';
import { ipEn } from './ip-display';

type DirectoryIp = Pick<Ip, 'id' | 'title'>;

/** A–Z 인덱스 바 항목 전수 — ALL + A–Z + ETC 28개(R-03 §3). 렌더 순서가 곧 이 배열 순서다. */
export const DIRECTORY_LETTERS: readonly string[] = [
  'ALL',
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  'ETC',
];

/** 표시명(영문 우선)의 디렉토리 이니셜 — A–Z 밖(한글·숫자·기호·빈 값)은 전부 ETC. */
export function directoryInitial(name: string): string {
  const first = name.trim().charAt(0);
  return /[a-z]/i.test(first) ? first.toUpperCase() : 'ETC';
}

/** A–Z 인덱스 바의 레터 필터 — ALL은 전체, 그 밖은 표시명 이니셜 일치만 남긴다. */
export function filterIpsByLetter<T extends DirectoryIp>(ips: readonly T[], letter: string): T[] {
  if (letter === 'ALL') return [...ips];
  return ips.filter((ip) => directoryInitial(ipEn(ip)) === letter);
}

/** 디렉토리 리스트 정렬 — 표시명 A→Z, ETC(비라틴 이니셜)는 항상 뒤. */
export function sortIpsForDirectory<T extends DirectoryIp>(ips: readonly T[]): T[] {
  return [...ips].sort((a, b) => {
    const aEtc = directoryInitial(ipEn(a)) === 'ETC';
    const bEtc = directoryInitial(ipEn(b)) === 'ETC';
    if (aEtc !== bEtc) return aEtc ? 1 : -1;
    return ipEn(a).localeCompare(ipEn(b), 'en');
  });
}
