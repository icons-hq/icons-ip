import { NextRequest, NextResponse } from 'next/server';
import { normalizeFaqFilters } from '@/lib/faq';
import { loadPublishedFaq } from '@/lib/faq.server';

export async function GET(request: NextRequest) {
  const filters = normalizeFaqFilters({ q: request.nextUrl.searchParams.get('q') ?? '' });
  const headers = { 'Cache-Control': 'no-store' };
  const featured = request.nextUrl.searchParams.get('featured') === '1' && !filters.query;
  if (!featured && filters.query.length < 2) return NextResponse.json({ entries: [] }, { headers });
  try {
    const { entries } = await loadPublishedFaq(filters, featured ? 6 : 3);
    return NextResponse.json({ entries }, { headers });
  } catch {
    return NextResponse.json({ error: 'FAQ를 불러오지 못했습니다.' }, { status: 503, headers });
  }
}
