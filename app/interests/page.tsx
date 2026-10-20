import { notFound } from 'next/navigation';
import { ProductInterests } from '@/components/screens/ProductInterests';
import { loadPublicDetailExperienceConfig } from '@/lib/product-detail-experiences.server';
export const metadata = { title: '관심 굿즈 — ICONS' };
export default async function InterestsPage() { if (!(await loadPublicDetailExperienceConfig()).interests) notFound(); return <ProductInterests />; }
