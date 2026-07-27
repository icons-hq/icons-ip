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
  editCommunityPostAction,
  reportCommunityTargetAction,
  setCommunityPostLikeAction,
  type CommunityCommentActionState,
  type CommunityPostEditActionState,
  type CommunityPostActionState,
} from '@/app/community/actions';
import type {
  CommunityChannel,
  CommunityFeedPost,
  CommunityFeedScope,
  CommunityReportTarget,
  CommunitySnapshot,
  CommunityViewerState,
} from '@/lib/community';
import { hrefFor } from '@/lib/routes';
import { Icon } from '@/components/ui/Icon';
import { Empty } from '@/components/ui/Empty';

const emptyState: CommunityPostActionState = {};
const emptyCommentState: CommunityCommentActionState = {};
const emptyEditState: CommunityPostEditActionState = {};
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
      style={{ minHeight: 44, padding: '0 6px', fontSize: 12.5, fontWeight: 700, color: 'var(--faint)', opacity: pending ? 0.6 : undefined }}
      type="submit"
    >
      {children}
    </button>
  );
}

function ReportForm({
  label,
  nextPath,
  targetId,
  targetType,
}: {
  label: string;
  nextPath: string;
  targetId: string;
  targetType: CommunityReportTarget;
}) {
  if (!isUuid(targetId)) return null;
  return (
    <form action={reportCommunityTargetAction}>
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />
      <SmallActionButton label={label}>신고</SmallActionButton>
    </form>
  );
}

function BlockUserForm({ authorId, nextPath }: { authorId: string; nextPath: string }) {
  if (!isUuid(authorId)) return null;
  return (
    <form action={blockCommunityUserAction}>
      <input type="hidden" name="next" value={nextPath} />
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
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 44, padding: '0 14px', borderRadius: 999,
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
    <button aria-label="댓글 게시" className="btn btn-sm" disabled={pending} style={{ height: 44, padding: '0 12px' }} type="submit">
      {pending ? <Icon name="clock" size={15} /> : <Icon name="arrowUp" size={15} />}
    </button>
  );
}

function CommentForm({ nextPath, postId }: { nextPath: string; postId: string }) {
  const [state, action] = useActionState(createCommunityCommentAction, emptyCommentState);
  const errorId = `comment-${postId}-error`;

  return (
    <form action={action} className="row" style={{ gap: 8, marginTop: 12, alignItems: 'start' }}>
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="postId" value={postId} />
      <div className="col" style={{ flex: 1, gap: 6 }}>
        <input
          aria-describedby={state.errors?.text || state.errors?.form ? errorId : undefined}
          aria-invalid={Boolean(state.errors?.text || state.errors?.form)}
          name="text"
          placeholder="댓글을 남겨보세요"
          style={{ width: '100%', height: 44, border: '1px solid var(--line-2)', background: 'var(--bg-2)', borderRadius: 10, padding: '0 11px', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
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
    <button aria-label={label} disabled={pending} style={{ minHeight: 44, padding: '0 6px', fontSize: 12.5, fontWeight: 700, color: 'var(--faint)', opacity: pending ? 0.6 : undefined }} type="submit">
      삭제
    </button>
  );
}

function EditSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-holo btn-sm" disabled={pending} style={{ minHeight: 44 }} type="submit">
      {pending ? '저장 중' : '저장'}
    </button>
  );
}

function PostEditForm({
  channels,
  nextPath,
  onCancel,
  open,
  post,
}: {
  channels: CommunityChannel[];
  nextPath: string;
  onCancel: () => void;
  open: boolean;
  post: CommunityFeedPost;
}) {
  const [state, action] = useActionState(editCommunityPostAction, emptyEditState);
  const formId = `community-post-edit-${post.id}`;
  const textInputId = `${formId}-text`;
  const ipInputId = `${formId}-ip`;
  const tagInputId = `${formId}-tag`;
  const textErrorId = `${formId}-text-error`;
  const ipErrorId = `${formId}-ip-error`;
  const formErrorId = `${formId}-form-error`;
  const currentIpIsActive = Boolean(
    post.ipId && channels.some((channel) => channel.id === post.ipId),
  );
  const defaultIpId = post.ipId ?? channels[0]?.id ?? '';

  return (
    <div hidden={!open} id={formId}>
      <form
        action={action}
        style={{ border: '1px solid var(--line-2)', borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}
      >
        <input name="next" type="hidden" value={nextPath} />
        <input name="postId" type="hidden" value={post.id} />
        <label className="sr-only" htmlFor={textInputId}>포스트 내용</label>
        <textarea
          aria-describedby={state.errors?.text ? textErrorId : undefined}
          aria-invalid={Boolean(state.errors?.text)}
          className="community-post-edit-control"
          defaultValue={post.text}
          id={textInputId}
          name="text"
          rows={4}
          style={{ width: '100%', minHeight: 96, resize: 'vertical', border: '1px solid var(--line-2)', background: 'var(--bg-2)', borderRadius: 10, padding: 11, color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', lineHeight: 1.55, outline: 'none' }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label className="sr-only" htmlFor={ipInputId}>IP 채널</label>
          <select
            aria-describedby={state.errors?.ipId ? ipErrorId : undefined}
            aria-invalid={Boolean(state.errors?.ipId)}
            className="community-post-edit-control"
            defaultValue={defaultIpId}
            disabled={!defaultIpId}
            id={ipInputId}
            name="ipId"
            style={{ height: 44, minWidth: 140, border: '1px solid var(--line-2)', background: 'var(--bg-2)', borderRadius: 10, padding: '0 11px', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
          >
            {post.ipId && !currentIpIsActive && (
              <option value={post.ipId}>[보관] {post.ipName}</option>
            )}
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>{channel.title}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor={tagInputId}>태그</label>
          <input
            className="community-post-edit-control"
            defaultValue={post.tag ?? ''}
            id={tagInputId}
            name="tag"
            placeholder="#태그"
            style={{ height: 44, minWidth: 140, flex: 1, border: '1px solid var(--line-2)', background: 'var(--bg-2)', borderRadius: 10, padding: '0 11px', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
          />
        </div>
        {post.img && (
          <p style={{ margin: 0, color: 'var(--faint)', fontSize: 12.5 }}>기존 이미지는 그대로 유지돼요.</p>
        )}
        <ErrorText id={textErrorId}>{state.errors?.text}</ErrorText>
        <ErrorText id={ipErrorId}>{state.errors?.ipId}</ErrorText>
        <div id={formErrorId} role="alert" style={{ color: 'var(--pink)', fontSize: 12.5, fontWeight: 600 }}>
          {state.errors?.form ?? state.errors?.postId}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} style={{ minHeight: 44 }} type="button">
            취소
          </button>
          <EditSubmitButton />
        </div>
      </form>
    </div>
  );
}

function PostCard({ channels, nextPath, p }: { channels: CommunityChannel[]; nextPath: string; p: CommunityFeedPost }) {
  const [editing, setEditing] = useState(false);
  const [editSession, setEditSession] = useState(0);
  const closeEditor = () => {
    setEditing(false);
    setEditSession((current) => current + 1);
  };
  const toggleEditor = () => {
    if (editing) {
      closeEditor();
      return;
    }
    setEditing(true);
  };
  const imageBackground = p.img && (p.img.startsWith('http') || p.img.startsWith('/'))
    ? `url("${p.img}") center / cover no-repeat`
    : p.img;

  return (
    <article className="community-post" style={{ borderRadius: 20, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 11 }}>
        <span style={{ width: 40, height: 40, borderRadius: 99, background: p.avatar, flex: '0 0 auto', boxShadow: '0 0 0 1px rgba(255,255,255,.12)', display: 'grid', placeItems: 'center', fontWeight: 700, color: '#0A0813' }}>
          {p.user[0]?.toUpperCase()}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>@{p.user}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{p.ipName} · {p.time}{p.isEdited ? ' · 수정됨' : ''}</span>
        </div>
        <div style={{ display: 'flex', marginLeft: 'auto', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <ReportForm label="포스트 신고" nextPath={nextPath} targetId={p.id} targetType="post" />
          {!p.canDelete && (
            <>
              <ReportForm label="사용자 신고" nextPath={nextPath} targetId={p.authorId} targetType="user" />
              <BlockUserForm authorId={p.authorId} nextPath={nextPath} />
            </>
          )}
          {p.canDelete && (
            <form action={deleteCommunityPostAction}>
              <input type="hidden" name="next" value={nextPath} />
              <input type="hidden" name="postId" value={p.id} />
              <DeleteButton label="포스트 삭제" />
            </form>
          )}
          {p.canEdit && (
            <button
              aria-controls={`community-post-edit-${p.id}`}
              aria-expanded={editing}
              aria-label="포스트 수정"
              className="community-post-edit-toggle"
              onClick={toggleEditor}
              style={{ minHeight: 44, minWidth: 44, padding: '0 6px', fontSize: 12.5, fontWeight: 700, color: 'var(--faint)' }}
              type="button"
            >
              수정
            </button>
          )}
        </div>
      </div>

      {p.canEdit && (
        <PostEditForm
          channels={channels}
          key={`${p.id}-${editSession}`}
          nextPath={nextPath}
          onCancel={closeEditor}
          open={editing}
          post={p}
        />
      )}

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
          <input type="hidden" name="next" value={nextPath} />
          <input type="hidden" name="postId" value={p.id} />
          <input type="hidden" name="shouldLike" value={p.likedByViewer ? '0' : '1'} />
          <LikeButton active={p.likedByViewer} likes={p.likes} />
        </form>
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px', borderRadius: 999, fontSize: 12, color: 'var(--dim)', border: '1px solid rgba(255,255,255,.1)' }}>
          💬 {p.comments}
        </span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--faint)' }}>#{p.tag ?? '커뮤니티'}</span>
      </div>

      {p.commentItems.length > 0 && (
        <div className="col" style={{ gap: 10, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          {p.commentItems.map((comment) => (
            <div key={comment.id} className="row" style={{ alignItems: 'start', flexWrap: 'wrap', gap: 10 }}>
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
                  <input type="hidden" name="next" value={nextPath} />
                  <input type="hidden" name="commentId" value={comment.id} />
                  <DeleteButton label="댓글 삭제" />
                </form>
              )}
              <ReportForm label="댓글 신고" nextPath={nextPath} targetId={comment.id} targetType="comment" />
              {!comment.canDelete && (
                <>
                  <ReportForm label="사용자 신고" nextPath={nextPath} targetId={comment.authorId} targetType="user" />
                  <BlockUserForm authorId={comment.authorId} nextPath={nextPath} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <CommentForm nextPath={nextPath} postId={p.id} />
    </article>
  );
}

function PostSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-holo btn-sm community-composer__submit" disabled={disabled || pending} type="submit">
      {pending ? '게시 중' : '올리기'}
    </button>
  );
}

function TrendingTags({ tags }: { tags: string[] }) {
  const normalizedTags = tags
    .map((tag) => tag.replace(/^#+/, ''))
    .filter(Boolean);

  return (
    <section
      aria-labelledby="community-trending-title"
      style={{
        gridColumn: '1 / -1',
        boxSizing: 'border-box',
        maxWidth: '100%',
        minWidth: 0,
        width: '100%',
        borderRadius: 18,
        border: '1px solid rgba(45,226,255,.2)',
        background: 'linear-gradient(120deg, rgba(45,226,255,.06), rgba(139,92,255,.08))',
        padding: '16px 18px',
      }}
    >
      <div
        className="mono"
        id="community-trending-title"
        style={{ fontSize: 11, letterSpacing: '.16em', color: 'var(--cyan)' }}
      >
        최근 7일 트렌딩
      </div>
      {normalizedTags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, maxWidth: '100%', minWidth: 0, width: '100%' }}>
          {normalizedTags.map((tag) => (
            <Link
              className="chip"
              href={`/search?q=${encodeURIComponent(tag)}`}
              key={tag}
              style={{
                height: 44,
                maxWidth: '100%',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontFamily: 'var(--ff-body)',
              }}
              title={`#${tag}`}
            >
              #{tag}
            </Link>
          ))}
        </div>
      ) : (
        <p style={{ margin: '10px 0 0', color: 'var(--dim)', fontSize: 13 }}>
          최근 7일 동안 집계된 태그가 없어요
        </p>
      )}
    </section>
  );
}

function Composer({
  channels,
  nextPath,
  selectedChannelId,
}: {
  channels: CommunityChannel[];
  nextPath: string;
  selectedChannelId: string;
}) {
  const [state, action] = useActionState(createCommunityPostAction, emptyState);
  const [imageName, setImageName] = useState('');
  const defaultIpId = channels.some((c) => c.id === selectedChannelId) ? selectedChannelId : channels[0]?.id ?? '';
  const disabled = !defaultIpId;

  return (
    <form action={action} className="community-composer">
      <input type="hidden" name="next" value={nextPath} />
      <div className="community-composer__main">
        <span aria-hidden className="community-composer__avatar" />
        <input
          aria-describedby={state.errors?.text ? 'community-text-error' : undefined}
          aria-invalid={Boolean(state.errors?.text)}
          className="community-composer__text"
          name="text"
          placeholder="오늘의 최애 소식을 들려주세요…"
        />
        <PostSubmitButton disabled={disabled} />
      </div>
      <div className="community-composer__controls">
        <select
          key={defaultIpId}
          aria-describedby={state.errors?.ipId ? 'community-ip-error' : undefined}
          aria-invalid={Boolean(state.errors?.ipId)}
          className="community-composer__channel"
          defaultValue={defaultIpId}
          disabled={disabled}
          name="ipId"
        >
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.title}</option>
          ))}
        </select>
        <input
          className="community-composer__tag"
          name="tag"
          placeholder="#태그"
        />
        <label className="community-composer__upload" htmlFor="community-composer-image">
          <span className="community-composer__upload-action">이미지 추가</span>
          <span aria-live="polite" className="community-composer__file-name">
            {imageName || 'JPG · PNG · WEBP · GIF'}
          </span>
          <input
            accept="image/jpeg,image/png,image/webp,image/gif"
            aria-describedby={state.errors?.image ? 'community-image-error' : undefined}
            aria-invalid={Boolean(state.errors?.image)}
            className="community-composer__file"
            id="community-composer-image"
            name="image"
            onChange={(event) => setImageName(event.currentTarget.files?.[0]?.name ?? '')}
            type="file"
          />
        </label>
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

function FeedScopeTabs({ feedScope }: { feedScope: CommunityFeedScope }) {
  const tabs: { href: string; label: string; scope: CommunityFeedScope }[] = [
    { href: '/community', label: '전체', scope: 'all' },
    { href: '/community?feed=fandom', label: '내 팬덤', scope: 'fandom' },
  ];

  return (
    <nav aria-label="커뮤니티 피드" style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
      {tabs.map((tab) => {
        const active = feedScope === tab.scope;
        return (
          <Link
            aria-current={active ? 'page' : undefined}
            href={tab.href}
            key={tab.scope}
            style={{
              alignItems: 'center',
              background: active ? 'rgba(255,77,157,.12)' : 'rgba(255,255,255,.03)',
              border: `1px solid ${active ? 'rgba(255,77,157,.5)' : 'var(--line)'}`,
              borderRadius: 999,
              color: active ? 'var(--text)' : 'var(--dim)',
              display: 'inline-flex',
              fontSize: 14,
              fontWeight: active ? 700 : 500,
              height: 44,
              justifyContent: 'center',
              padding: '0 18px',
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function FandomGate({ viewerState }: { viewerState: CommunityViewerState }) {
  const next = '/community?feed=fandom';
  const state = viewerState === 'guest'
    ? {
        text: '내 팬덤 피드는 로그인 후 볼 수 있어요',
        sub: '팔로우한 IP의 이야기만 모아서 보여드릴게요.',
        href: `/login?next=${encodeURIComponent(next)}`,
        label: '로그인하기',
      }
    : viewerState === 'onboarding'
      ? {
          text: '관심 IP를 고르면 내 팬덤 피드가 열려요',
          sub: '온보딩을 마치고 첫 팬덤을 선택해주세요.',
          href: `/onboarding?next=${encodeURIComponent(next)}`,
          label: '온보딩 계속하기',
        }
      : {
          text: '팔로우한 IP가 아직 없어요',
          sub: 'IP 허브에서 최애를 팔로우하면 이곳에 이야기가 모여요.',
          href: '/ip',
          label: 'IP 둘러보기',
        };

  return (
    <div className="col" style={{ alignItems: 'center', border: '1px solid var(--line)', borderRadius: 20, gap: 14, padding: '28px 20px', textAlign: 'center' }}>
      <Empty icon="chat" text={state.text} sub={state.sub} />
      <Link className="btn btn-holo" href={state.href} style={{ minHeight: 44, padding: '0 20px' }}>
        {state.label}
      </Link>
    </div>
  );
}

export function Community({
  feedScope,
  initialChannelId,
  snapshot,
  viewerState,
}: {
  feedScope: CommunityFeedScope;
  initialChannelId?: string;
  snapshot: CommunitySnapshot;
  viewerState: CommunityViewerState;
}) {
  const [selectedChannelId, setSelectedChannelId] = useState(initialChannelId ?? 'all');
  const channels = snapshot.channels;
  const channelId = selectedChannelId === 'all' || channels.some((channel) => channel.id === selectedChannelId)
    ? selectedChannelId
    : 'all';
  const posts = snapshot.posts.filter((post) => channelId === 'all' || post.ipId === channelId);
  const nextPath = feedScope === 'fandom' ? '/community?feed=fandom' : '/community';
  const hasFandomFollows = snapshot.hasFandomFollows ?? channels.length > 0;
  const fandomReady = feedScope !== 'fandom' || (viewerState === 'onboarded' && hasFandomFollows);

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
        onClick={() => setSelectedChannelId(id)}
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
          <TrendingTags tags={snapshot.trending} />
          <FeedScopeTabs feedScope={feedScope} />

          {/* channels */}
          <div className="community-channels" role="group" aria-label="팬덤 채널">
            {channelButton('all', feedScope === 'fandom' ? '내 팬덤 전체' : '전체 피드', 'var(--holo)')}
            {channels.map((c) => channelButton(c.id, c.title, c.color))}
          </div>

          {/* feed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            {fandomReady ? (
              <>
                {channels.length > 0 && (
                  <Composer channels={channels} nextPath={nextPath} selectedChannelId={channelId} />
                )}
                {posts.map((post) => (
                  <PostCard channels={channels} key={post.id} nextPath={nextPath} p={post} />
                ))}
                {!posts.length && feedScope === 'fandom' && channelId === 'all' ? (
                  <div className="col" style={{ alignItems: 'center', gap: 12, padding: '18px 0' }}>
                    <Empty
                      icon="chat"
                      text={channels.length > 0 ? '내 팬덤의 첫 이야기를 남겨보세요' : '보관된 팬덤의 지난 이야기가 아직 없어요'}
                      sub={channels.length > 0
                        ? '위 컴포저에서 포스트를 쓰거나 전체 피드의 이야기를 둘러보세요.'
                        : '새 글은 운영 중인 IP를 팔로우한 뒤 작성할 수 있어요.'}
                    />
                    <Link className="btn btn-ghost" href="/community" style={{ minHeight: 44 }}>
                      전체 피드 보기
                    </Link>
                  </div>
                ) : !posts.length ? (
                  <Empty
                    icon="chat"
                    text={channelId !== 'all' ? `${channels.find((c) => c.id === channelId)?.title ?? ''} 채널의 첫 이야기를 남겨보세요` : '아직 포스트가 없어요'}
                    sub={channelId !== 'all' ? undefined : '첫 번째 포스트를 작성해보세요'}
                  />
                ) : null}
              </>
            ) : (
              <FandomGate viewerState={viewerState} />
            )}
          </div>

          {/* side rail */}
          <div className="community-rail hide-mob" style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 'var(--header-offset)' }}>
            {feedScope === 'all' && ranking.length > 0 && (
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
              <Link className="btn btn-holo btn-sm" href={hrefFor('packs')} style={{ marginTop: 14, position: 'relative', fontSize: 12.5 }}>
                카드팩 열기 →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
