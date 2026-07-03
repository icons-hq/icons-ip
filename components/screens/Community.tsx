'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import {
  blockCommunityUserAction,
  createCommunityCommentAction,
  createCommunityPostAction,
  deleteCommunityCommentAction,
  deleteCommunityPostAction,
  reportCommunityTargetAction,
  setCommunityPostLikeAction,
  type CommunityCommentActionState,
  type CommunityPostActionState,
} from '@/app/community/actions';
import type { CommunityChannel, CommunityFeedPost, CommunityReportTarget, CommunitySnapshot } from '@/lib/community';
import { hrefFor } from '@/lib/routes';
import { Icon } from '@/components/ui/Icon';
import { Empty } from '@/components/ui/Empty';

const emptyState: CommunityPostActionState = {};
const emptyCommentState: CommunityCommentActionState = {};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ErrorText({ children, id }: { children?: string; id: string }) {
  if (!children) return null;
  return (
    <span id={id} style={{ color: 'var(--pink)', fontSize: 12.5, fontWeight: 600 }}>
      {children}
    </span>
  );
}

function isUuid(value: string | null | undefined) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function SmallActionButton({ children, label }: { children: ReactNode; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-label={label}
      disabled={pending}
      style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--faint)', opacity: pending ? 0.6 : undefined }}
      type="submit"
    >
      {children}
    </button>
  );
}

function ReportForm({ label, targetId, targetType }: { label: string; targetId: string; targetType: CommunityReportTarget }) {
  if (!isUuid(targetId)) return null;
  return (
    <form action={reportCommunityTargetAction}>
      <input type="hidden" name="next" value="/community" />
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />
      <SmallActionButton label={label}>신고</SmallActionButton>
    </form>
  );
}

function BlockUserForm({ authorId }: { authorId: string }) {
  if (!isUuid(authorId)) return null;
  return (
    <form action={blockCommunityUserAction}>
      <input type="hidden" name="next" value="/community" />
      <input type="hidden" name="targetUserId" value={authorId} />
      <SmallActionButton label="사용자 차단">차단</SmallActionButton>
    </form>
  );
}

function LikeButton({ active, likes }: { active?: boolean; likes: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-label={active ? '좋아요 취소' : '좋아요'}
      aria-pressed={active}
      className="mono"
      disabled={pending}
      type="submit"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px', borderRadius: 999,
        fontSize: 12, fontWeight: active ? 700 : 400,
        color: active ? 'var(--pink)' : 'var(--dim)',
        border: `1px solid ${active ? 'rgba(255,77,157,.5)' : 'rgba(255,255,255,.1)'}`,
        background: active ? 'rgba(255,77,157,.1)' : 'transparent',
        opacity: pending ? 0.6 : undefined,
        transition: 'all .2s ease',
      }}
    >
      ♥ {likes}
    </button>
  );
}

function CommentSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button aria-label="댓글 게시" className="btn btn-sm" disabled={pending} style={{ height: 36, padding: '0 12px' }} type="submit">
      {pending ? <Icon name="clock" size={15} /> : <Icon name="arrowUp" size={15} />}
    </button>
  );
}

function CommentForm({ postId }: { postId: string }) {
  const [state, action] = useActionState(createCommunityCommentAction, emptyCommentState);
  const errorId = `comment-${postId}-error`;

  return (
    <form action={action} className="row" style={{ gap: 8, marginTop: 12, alignItems: 'start' }}>
      <input type="hidden" name="next" value="/community" />
      <input type="hidden" name="postId" value={postId} />
      <div className="col" style={{ flex: 1, gap: 6 }}>
        <input
          aria-describedby={state.errors?.text || state.errors?.form ? errorId : undefined}
          aria-invalid={Boolean(state.errors?.text || state.errors?.form)}
          name="text"
          placeholder="댓글을 남겨보세요"
          style={{ width: '100%', height: 36, border: '1px solid var(--line-2)', background: 'var(--bg-2)', borderRadius: 10, padding: '0 11px', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
        />
        <ErrorText id={errorId}>{state.errors?.text ?? state.errors?.form ?? state.errors?.postId}</ErrorText>
      </div>
      <CommentSubmitButton />
    </form>
  );
}

function DeleteButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button aria-label={label} disabled={pending} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--faint)', opacity: pending ? 0.6 : undefined }} type="submit">
      삭제
    </button>
  );
}

function PostCard({ p }: { p: CommunityFeedPost }) {
  const imageBackground = p.img && (p.img.startsWith('http') || p.img.startsWith('/'))
    ? `url("${p.img}") center / cover no-repeat`
    : p.img;

  return (
    <article className="community-post" style={{ borderRadius: 20, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ width: 40, height: 40, borderRadius: 99, background: p.avatar, flex: '0 0 auto', boxShadow: '0 0 0 1px rgba(255,255,255,.12)', display: 'grid', placeItems: 'center', fontWeight: 700, color: '#0A0813' }}>
          {p.user[0]?.toUpperCase()}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>@{p.user}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{p.ipName} · {p.time}</span>
        </div>
        <div style={{ display: 'flex', marginLeft: 'auto', gap: 10, alignItems: 'center' }}>
          <ReportForm label="포스트 신고" targetId={p.id} targetType="post" />
          {!p.canDelete && (
            <>
              <ReportForm label="사용자 신고" targetId={p.authorId} targetType="user" />
              <BlockUserForm authorId={p.authorId} />
            </>
          )}
          {p.canDelete && (
            <form action={deleteCommunityPostAction}>
              <input type="hidden" name="next" value="/community" />
              <input type="hidden" name="postId" value={p.id} />
              <DeleteButton label="포스트 삭제" />
            </form>
          )}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: '#DDD8F2', textWrap: 'pretty', whiteSpace: 'pre-line' }}>{p.text}</p>

      {imageBackground && (
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ width: 132, aspectRatio: '5 / 7', borderRadius: 12, background: imageBackground, boxShadow: '0 0 0 1px rgba(255,255,255,.12)', position: 'relative', overflow: 'hidden' }}>
            <span aria-hidden className="sheen" style={{ opacity: 0.35 }} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <form action={setCommunityPostLikeAction}>
          <input type="hidden" name="next" value="/community" />
          <input type="hidden" name="postId" value={p.id} />
          <input type="hidden" name="shouldLike" value={p.likedByViewer ? '0' : '1'} />
          <LikeButton active={p.likedByViewer} likes={p.likes} />
        </form>
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px', borderRadius: 999, fontSize: 12, color: 'var(--dim)', border: '1px solid rgba(255,255,255,.1)' }}>
          💬 {p.comments}
        </span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--faint)' }}>#{p.tag}</span>
      </div>

      {p.commentItems.length > 0 && (
        <div className="col" style={{ gap: 10, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          {p.commentItems.map((comment) => (
            <div key={comment.id} className="row" style={{ alignItems: 'start', gap: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: 99, background: 'var(--surface-2)', flex: '0 0 auto', display: 'grid', placeItems: 'center', fontWeight: 800, color: 'var(--violet-2)', fontSize: 11 }}>
                {comment.user[0]?.toUpperCase()}
              </span>
              <div className="col" style={{ minWidth: 0, gap: 3, flex: 1 }}>
                <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>@{comment.user}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{comment.time}</span>
                </div>
                <p style={{ fontSize: 13.5, lineHeight: 1.45, margin: 0 }}>{comment.text}</p>
              </div>
              {comment.canDelete && (
                <form action={deleteCommunityCommentAction}>
                  <input type="hidden" name="next" value="/community" />
                  <input type="hidden" name="commentId" value={comment.id} />
                  <DeleteButton label="댓글 삭제" />
                </form>
              )}
              <ReportForm label="댓글 신고" targetId={comment.id} targetType="comment" />
              {!comment.canDelete && (
                <>
                  <ReportForm label="사용자 신고" targetId={comment.authorId} targetType="user" />
                  <BlockUserForm authorId={comment.authorId} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <CommentForm postId={p.id} />
    </article>
  );
}

function PostSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-holo btn-sm" disabled={disabled || pending} style={{ flex: '0 0 auto' }}>
      {pending ? '게시 중' : '올리기'}
    </button>
  );
}

function Composer({ channels, selectedChannelId }: { channels: CommunityChannel[]; selectedChannelId: string }) {
  const [state, action] = useActionState(createCommunityPostAction, emptyState);
  const defaultIpId = channels.some((c) => c.id === selectedChannelId) ? selectedChannelId : channels[0]?.id ?? '';
  const disabled = !defaultIpId;

  return (
    <form action={action} style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,.09)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input type="hidden" name="next" value="/community" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 38, height: 38, borderRadius: 99, background: 'linear-gradient(135deg, #8B5CFF, #FF4D9D)', flex: '0 0 auto' }} />
        <input
          aria-describedby={state.errors?.text ? 'community-text-error' : undefined}
          aria-invalid={Boolean(state.errors?.text)}
          name="text"
          placeholder="오늘의 최애 소식을 들려주세요…"
          style={{ flex: 1, minWidth: 0, height: 40, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 14.5, fontFamily: 'inherit' }}
        />
        <PostSubmitButton disabled={disabled} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingLeft: 50 }}>
        <select
          key={defaultIpId}
          aria-describedby={state.errors?.ipId ? 'community-ip-error' : undefined}
          aria-invalid={Boolean(state.errors?.ipId)}
          defaultValue={defaultIpId}
          disabled={disabled}
          name="ipId"
          style={{ height: 32, border: '1px solid var(--line-2)', background: 'var(--bg-2)', borderRadius: 999, padding: '0 12px', color: 'var(--dim)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }}
        >
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.title}</option>
          ))}
        </select>
        <input
          name="tag"
          placeholder="#태그"
          style={{ width: 110, height: 32, border: '1px solid var(--line-2)', background: 'var(--bg-2)', borderRadius: 999, padding: '0 12px', color: 'var(--dim)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }}
        />
        <input
          accept="image/jpeg,image/png,image/webp,image/gif"
          aria-describedby={state.errors?.image ? 'community-image-error' : undefined}
          aria-invalid={Boolean(state.errors?.image)}
          name="image"
          type="file"
          style={{ fontSize: 12, color: 'var(--faint)', maxWidth: '100%' }}
        />
      </div>
      <ErrorText id="community-ip-error">{state.errors?.ipId}</ErrorText>
      <ErrorText id="community-text-error">{state.errors?.text}</ErrorText>
      <ErrorText id="community-image-error">{state.errors?.image}</ErrorText>
      {state.errors?.form && (
        <div role="alert" style={{ color: 'var(--pink)', fontSize: 13, fontWeight: 700 }}>
          {state.errors.form}
        </div>
      )}
    </form>
  );
}

export function Community({ snapshot, initialChannelId }: { snapshot: CommunitySnapshot; initialChannelId?: string }) {
  const [channelId, setChannelId] = useState(initialChannelId ?? 'all');
  const channels = snapshot.channels;
  const posts = snapshot.posts.filter((post) => channelId === 'all' || post.ipId === channelId);

  /* 디자인의 "위클리 랭킹" mock을 실데이터 파생(작성자별 좋아요 합)으로 대체 */
  const ranking = useMemo(() => {
    const byUser = new Map<string, { name: string; avatar: string; score: number }>();
    for (const post of snapshot.posts) {
      const entry = byUser.get(post.user) ?? { name: post.user, avatar: post.avatar, score: 0 };
      entry.score += post.likes;
      byUser.set(post.user, entry);
    }
    return [...byUser.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  }, [snapshot.posts]);

  const rankColor = (i: number) => (i === 0 ? 'var(--amber)' : i === 1 ? 'var(--dim)' : i === 2 ? '#B87A4B' : 'var(--faint)');

  const channelButton = (id: string, title: string, dot: string, members?: string) => {
    const active = channelId === id;
    return (
      <button
        key={id}
        type="button"
        aria-pressed={active}
        onClick={() => setChannelId(id)}
        style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, height: 46, padding: '0 14px',
          borderRadius: 14, fontSize: 14, fontWeight: active ? 700 : 500, textAlign: 'left',
          color: active ? 'var(--text)' : 'var(--dim)',
          border: `1px solid ${active ? 'rgba(139,92,255,.55)' : 'rgba(255,255,255,.09)'}`,
          background: active ? 'rgba(139,92,255,.12)' : 'rgba(255,255,255,.02)',
          transition: 'all .25s ease',
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 99, background: dot, flex: '0 0 auto' }} />
        {title}
        {members && <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginLeft: 'auto', paddingLeft: 8 }}>{members}</span>}
      </button>
    );
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* header */}
      <header style={{ padding: '128px 0 0' }}>
        <div className="wrap" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="eyebrow rise" style={{ color: 'var(--pink)' }}>떠들어요 · 팬덤 채널</div>
            <h1 className="rise" style={{ margin: '14px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(38px, 5.6vw, 72px)', lineHeight: 1.02, letterSpacing: '-0.04em', animationDelay: '.08s' }}>
              같은 최애,<br />같은 온도
            </h1>
          </div>
          <span className="mono rise" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--mint)', animationDelay: '.14s' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--mint)', boxShadow: '0 0 10px var(--mint)' }} />
            지금 이야기 {snapshot.posts.length}개
          </span>
        </div>
      </header>

      {/* main */}
      <section style={{ padding: '34px 0 clamp(70px, 9vw, 110px)' }}>
        <div className="wrap community-main">
          {/* channels */}
          <div className="community-channels" role="group" aria-label="팬덤 채널">
            {channelButton('all', '전체 피드', 'var(--holo)')}
            {channels.map((c) => channelButton(c.id, c.title, c.color))}
          </div>

          {/* feed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <Composer channels={channels} selectedChannelId={channelId} />
            {posts.map((post) => (
              <PostCard key={post.id} p={post} />
            ))}
            {!posts.length && (
              <Empty
                icon="chat"
                text={channelId !== 'all' ? `${channels.find((c) => c.id === channelId)?.title ?? ''} 채널의 첫 이야기를 남겨보세요` : '아직 포스트가 없어요'}
                sub={channelId !== 'all' ? undefined : '첫 번째 포스트를 작성해보세요'}
              />
            )}
          </div>

          {/* side rail */}
          <div className="community-rail hide-mob" style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 88 }}>
            {ranking.length > 0 && (
              <div style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,.09)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', padding: 18 }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--amber)' }}>팬덤 랭킹</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
                  {ranking.map((r, i) => (
                    <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: rankColor(i), width: 18, flex: '0 0 auto' }}>{i + 1}</span>
                      <span style={{ width: 30, height: 30, borderRadius: 99, background: r.avatar, flex: '0 0 auto', boxShadow: '0 0 0 1px rgba(255,255,255,.12)' }} />
                      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{r.name}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginLeft: 'auto', flex: '0 0 auto' }}>♥ {r.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ borderRadius: 20, border: '1px solid rgba(139,92,255,.35)', background: 'linear-gradient(180deg, var(--surface-2), var(--bg-2))', padding: 18, position: 'relative', overflow: 'hidden' }}>
              <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(300px 160px at 80% 0%, rgba(139,92,255,.2), transparent 70%)' }} />
              <div className="mono" style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--violet-2)', position: 'relative' }}>지금 열린 카드풀</div>
              <div style={{ fontWeight: 700, fontSize: 15.5, marginTop: 10, lineHeight: 1.4, position: 'relative' }}>
                새 카드풀이 열려 있어요<br />오늘의 운을 시험해 보세요
              </div>
              <Link className="btn btn-holo btn-sm" href={hrefFor('gacha')} style={{ marginTop: 14, position: 'relative', fontSize: 12.5 }}>
                뽑으러 가기 →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
