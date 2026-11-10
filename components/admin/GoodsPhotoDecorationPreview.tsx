import { photoPathData, type PhotoGeometryPath } from '@/lib/admin/photo-editor-decorations';

/** Only numeric, first-party geometry reaches this inert preview; no SVG/XML input. */
export function GoodsPhotoDecorationPreview({ paths, height = 100 }: { paths: readonly PhotoGeometryPath[]; height?: number }) {
  return <svg className="block h-[60px] w-full max-w-[84px] rounded-md bg-muted" viewBox={`0 0 100 ${height}`} aria-hidden="true" focusable="false">
    {paths.map((path, index) => <path key={index} d={photoPathData(path.commands)}
      fill={path.fill === 'ink' ? 'currentColor' : path.fill === 'paper' ? 'var(--background)' : 'none'}
      stroke={path.stroke ? 'currentColor' : 'none'} strokeWidth={path.strokeWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={path.dash?.join(' ')} />)}
  </svg>;
}
