import type { ImageProps } from 'next/image';

/** Fixture-only image rendering. The real Next image route is tested in the connected app. */
export default function FixtureImage({ src, alt, width, height, className, style, fill, sizes }: ImageProps) {
  const url = typeof src === 'string' ? src : 'default' in src ? src.default.src : src.src;
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} src={url} width={width} height={height} className={className} sizes={sizes}
    style={{ ...(fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } as const : {}), ...style }} />;
}
