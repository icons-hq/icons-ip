import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GalleryBestReviews } from './GalleryBestReviews';
vi.mock('./ProductDetailReviewLink',()=>({ProductDetailReviewLink:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
const cards=[1,2,3].map(n=>({id:`93500000-0000-4000-8000-${String(n).padStart(12,'0')}`,rating:n,body:`실제 선정한 ${n}점 리뷰`,authorName:'구매자',createdAt:'2026-10-12T23:30:00Z',imageUrls:[],...(n===1?{eventDisclosure:{eventTitle:'합성 후기 이벤트',revoked:false}}:{})}));
describe('대표 이미지 선정 리뷰',()=>{
 it('최소3개 조건을 지키며 일반 리뷰·낮은평점과 혜택고지를 보존한다',()=>{expect(renderToStaticMarkup(<GalleryBestReviews goodId="good" cards={cards.slice(0,2)} />)).toBe('');const html=renderToStaticMarkup(<GalleryBestReviews goodId="good" cards={cards} />);expect(html).toContain('운영자가 선정한 구매 리뷰');expect(html).toContain('1점 리뷰');expect(html).toContain('합성 후기 이벤트');expect(html).toContain('2026. 10. 13.');expect((html.match(/<li>/g)??[])).toHaveLength(3);expect(html).toContain('reviewPage=1#reviews');});
});
