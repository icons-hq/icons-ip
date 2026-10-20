import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { ShoppingStoryScreen } from '@/components/screens/ShoppingStories';
import { getPublicShoppingStory } from '@/lib/shopping-stories.server';
const loadStory = cache(getPublicShoppingStory);
type Props = { params: Promise<{ storyId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const story = await loadStory((await params).storyId);
  if (!story) notFound();
  return { title: `${story.title} — ICONS`, description: story.description || undefined };
}
export default async function ShoppingStoryPage({ params }: Props) {
  const story = await loadStory((await params).storyId);
  if (!story) notFound();
  return <ShoppingStoryScreen story={story} />;
}
