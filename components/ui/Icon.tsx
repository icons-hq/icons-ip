import type { CSSProperties } from 'react';

const PATHS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
  ip: 'M4 5h16v14H4zM4 9h16M9 9v10',
  shop: 'M6 7V6a6 6 0 0 1 12 0v1M4 7h16l-1 13H5z',
  card: 'M3 7h18v10H3zM3 11h18M7 15h4',
  spark: 'M12 3l2.2 6.2L20 12l-5.8 2.8L12 21l-2.2-6.2L4 12l5.8-2.8z',
  event: 'M7 3v3M17 3v3M4 8h16M5 6h14v14H5zM9 13h2v2H9z',
  chat: 'M4 5h16v11H9l-4 3v-3H4z',
  swap: 'M7 8h12l-3-3M17 16H5l3 3',
  bag: 'M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  heart: 'M12 20S4 14.5 4 9a4 4 0 0 1 7-2.6A4 4 0 0 1 20 9c0 5.5-8 11-8 11z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  trendUp: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  trendDown: 'M3 7l6 6 4-4 8 8M15 17h6v-6',
  plus: 'M12 5v14M5 12h14',
  fire: 'M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c2 2 3 3 3 6a5 5 0 0 1-10 0c0-4 4-5 5-13z',
  bolt: 'M13 3 4 14h6l-1 7 9-11h-6z',
  check: 'M5 12l5 5L20 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  hammer: 'M14 6l4 4M11 9l-7 7 3 3 7-7M13 4l7 7',
  close: 'M6 6l12 12M18 6 6 18',
  star: 'M12 3l2.5 6 6.5.5-5 4.2L17.5 20 12 16.5 6.5 20 8 13.7l-5-4.2 6.5-.5z',
  lock: 'M6 10V8a6 6 0 0 1 12 0v2M5 10h14v10H5z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
};

export interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  fill?: boolean | string;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, stroke = 1.7, fill, style }: IconProps) {
  const fillColor = fill === true ? 'currentColor' : fill;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fillColor || 'none'}
      stroke="currentColor"
      strokeWidth={fill ? 0 : stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
