import { NextResponse } from 'next/server';
import { parseCategoryDisplayRequest } from '@/lib/category-display';
import { CategoryDisplayStaleError, loadCategoryDisplayPage } from '@/lib/category-display.server';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const values: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) { const all = params.getAll(key); values[key] = all.length === 1 ? all[0] : all; }
  const input = parseCategoryDisplayRequest(values), offsetText = params.get('offset');
  const offset = offsetText !== null && /^\d+$/.test(offsetText) ? Number(offsetText) : NaN;
  const token = params.get('token'), headers = { 'Cache-Control': 'no-store' };
  if (!input || params.getAll('offset').length !== 1 || params.getAll('token').length !== 1 || !Number.isSafeInteger(offset) || offset < 20 || offset > 10_000_000 || offset % 20 !== 0 || !token || !/^[a-f0-9]{32}$/.test(token))
    return NextResponse.json({ error: '조회 조건을 확인해주세요.' }, { status: 400, headers });
  try {
    const page = await loadCategoryDisplayPage(input.categoryId, input.query, offset, token);
    if (!page) return NextResponse.json({ error: '전시를 확인할 수 없습니다.' }, { status: 404, headers });
    return NextResponse.json({ goods: page.result.goods, token: page.token, nextOffset: page.nextOffset, checkedAt: page.checkedAt }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CategoryDisplayStaleError ? error.message : '전시 상품을 불러오지 못했습니다.' }, { status: error instanceof CategoryDisplayStaleError ? 409 : 503, headers });
  }
}
