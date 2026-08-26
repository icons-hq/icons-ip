export interface SectionHeadingProps {
  title: string;
  subcopy?: string;
  as?: 'h1' | 'h2' | 'h3';
  id?: string;
  className?: string;
}

export function SectionHeading({ as: Heading = 'h2', className, id, subcopy, title }: SectionHeadingProps) {
  return (
    <header className={`wc-section-heading${className ? ` ${className}` : ''}`}>
      <Heading className="wc-section-heading__title" id={id}>{title}</Heading>
      {subcopy ? <p className="wc-section-heading__subcopy">{subcopy}</p> : null}
    </header>
  );
}
