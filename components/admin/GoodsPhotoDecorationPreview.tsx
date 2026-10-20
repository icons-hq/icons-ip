import { photoPathData, type PhotoGeometryPath } from '@/lib/admin/photo-editor-decorations';

/** Only numeric, first-party geometry reaches this inert preview; no SVG/XML input. */
export function GoodsPhotoDecorationPreview({ paths, height = 100 }: { paths: readonly PhotoGeometryPath[]; height?: number }) {
  return <svg className="admin-photo-editor__decoration-preview" viewBox={`0 0 100 ${height}`} aria-hidden="true" focusable="false">
    {paths.map((path, index) => <path key={index} d={photoPathData(path.commands)}
      fill={path.fill === 'ink' ? 'currentColor' : path.fill === 'paper' ? 'var(--wc-surface)' : 'none'}
      stroke={path.stroke ? 'currentColor' : 'none'} strokeWidth={path.strokeWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={path.dash?.join(' ')} />)}
  </svg>;
}
