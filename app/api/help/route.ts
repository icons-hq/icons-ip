import { NextRequest, NextResponse } from 'next/server';
import { isFaqWidgetTopic, normalizeFaqFilters } from '@/lib/faq';
import { loadFaqWidgetTopicAnswer, loadPublishedFaq } from '@/lib/faq.server';

export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  /* 상담 위젯의 유형 버튼(0901-044): 대표 FAQ 또는 그 유형 카테고리의 공개 FAQ 목록. */
  const topic = request.nextUrl.searchParams.get('topic');
  if (topic !== null) {
    if (!isFaqWidgetTopic(topic)) return NextResponse.json({ error: '알 수 없는 문의 유형입니다.' }, { status: 400, headers });
    try {
      return NextResponse.json(await loadFaqWidgetTopicAnswer(topic), { headers });
    } catch {
      return NextResponse.json({ error: 'FAQ를 불러오지 못했습니다.' }, { status: 503, headers });
    }
  }
  const filters = normalizeFaqFilters({ q: request.nextUrl.searchParams.get('q') ?? '' });
  const featured = request.nextUrl.searchParams.get('featured') === '1' && !filters.query;
  if (!featured && filters.query.length < 2) return NextResponse.json({ entries: [] }, { headers });
  try {
    const { entries } = await loadPublishedFaq(filters, featured ? 6 : 3);
    return NextResponse.json({ entries }, { headers });
  } catch {
    return NextResponse.json({ error: 'FAQ를 불러오지 못했습니다.' }, { status: 503, headers });
  }
}
