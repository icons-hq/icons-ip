import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getBusinessInfo } from '@/lib/legal/business-info.server';
import { LegalDocumentScreen } from '@/components/screens/LegalDocument';
import { LEGAL_DOCUMENT_SLUGS, getLegalDocument } from '@/lib/legal/documents';

type PageProps = { params: Promise<{ document: string }> };

export function generateStaticParams() {
  return LEGAL_DOCUMENT_SLUGS.map((document) => ({ document }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { document } = await params;
  const legal = getLegalDocument(document);
  return legal ? { title: `${legal.title} — ICONS`, description: legal.summary } : { title: 'ICONS' };
}

export default async function Page({ params }: PageProps) {
  const { document } = await params;
  const legal = getLegalDocument(document,await getBusinessInfo());
  if (!legal) notFound();

  return <LegalDocumentScreen document={legal} />;
}
