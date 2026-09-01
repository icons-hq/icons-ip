'use client';

/* 커뮤니티 피드 — White Catalog 재조판 (DESIGN.md §6 content-card 행·§8 커뮤니티 행, S5 계약 §2 .wc-community).
   8개 커뮤니티 액션의 FormData 필드·hidden 필드·aria 연결·UUID 가드·editSession 세대 리셋은
   동결 계약이다(S5 §4) — 이 파일은 마크업과 스타일만 바꾼다. 블록 스킨은 wc-discovery.css 가 담당한다. */

import Link from 'next/link';
import { useActionState, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
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
import { EmptyState } from '@/components/wc/EmptyState';
import { WcButton } from '@/components/wc/WcButton';
import { useCardRewardsEnabled } from '@/components/shell/CardRewardAvailability';

const emptyState: CommunityPostActionState = {};
const emptyCommentState: CommunityCommentActionState = {};
const emptyEditState: CommunityPostEditActionState = {};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* select 는 wc-discovery 의 인풋 규칙 범위 밖이라 여기서 같은 각진 문법으로 맞춘다. */
const selectStyle: CSSProperties = {
  background: 'var(--wc-surface)',
  border: '1px solid var(--wc-line-control)',
  borderRadius: 0,
  color: 'var(--wc-ink)',
  fontFamily: 'inherit',
  fontSize: 15,
  height: 50,
  minWidth: 0,
  padding: '0 12px',
};

/* 신고·차단·수정·삭제류 텍스트 버튼(S5 §2 .wc-community__actions): 12.5px ink-tertiary, 44px 타깃.
   폼 안에 중첩돼 wc-discovery 의 `.wc-community__actions > *` 가 닿지 않는 버튼용. */
const textActionStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--wc-ink-tertiary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 700,
  minHeight: 44,
  padding: '0 6px',
};

function ErrorText({ children, id }: { children?: string; id: string }) {
  if (!children) return null;
  return (
    <span id={id} style={{ color: 'var(--wc-danger)', fontSize: 13, letterSpacing: '-0.38px' }}>
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
      style={{ ...textActionStyle, opacity: pending ? 0.6 : undefined }}
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
      disabled={pending}
      type="submit"
      style={{
        alignItems: 'center',
        background: 'none',
        border: 'none',
        /* 좋아요 카운트 텍스트는 잉크, 활성 하트만 액센트(S5 §2 .wc-community__actions). */
        color: 'var(--wc-ink)',
        cursor: 'pointer',
        display: 'inline-flex',
        fontFamily: 'inherit',
        fontSize: 12.5,
        fontWeight: active ? 700 : 500,
        gap: 6,
        minHeight: 44,
        opacity: pending ? 0.6 : undefined,
        padding: '0 8px',
      }}
    >
      <span aria-hidden style={{ color: active ? 'var(--wc-accent)' : 'var(--wc-ink-tertiary)' }}>♥</span>
      {likes}
    </button>
  );
}

function CommentSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      aria-label="댓글 게시"
      className="wc-btn primary"
      disabled={pending}
      style={{ flex: '0 0 auto', padding: '0 14px', width: 'auto' }}
      type="submit"
    >
      {pending ? <Icon name="clock" size={15} /> : <Icon name="arrowUp" size={15} />}
    </button>
  );
}

function CommentForm({ nextPath, postId }: { nextPath: string; postId: string }) {
  const [state, action] = useActionState(createCommunityCommentAction, emptyCommentState);
  const errorId = `comment-${postId}-error`;

  return (
    <form action={action} style={{ alignItems: 'flex-start', display: 'flex', gap: 8, marginTop: 12 }}>
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="postId" value={postId} />
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <input
          aria-describedby={state.errors?.text || state.errors?.form ? errorId : undefined}
          aria-invalid={Boolean(state.errors?.text || state.errors?.form)}
          name="text"
          placeholder="댓글을 남겨보세요"
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
    <button
      aria-label={label}
      disabled={pending}
      style={{ ...textActionStyle, opacity: pending ? 0.6 : undefined }}
      type="submit"
    >
      삭제
    </button>
  );
}

function EditSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="wc-btn primary"
      disabled={pending}
      style={{ fontSize: 15, padding: '0 18px', width: 'auto' }}
      type="submit"
    >
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
        style={{ border: '1px solid var(--wc-hairline)', display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}
      >
        <input name="next" type="hidden" value={nextPath} />
        <input name="postId" type="hidden" value={post.id} />
        <label className="wc-sr-only" htmlFor={textInputId}>포스트 내용</label>
        <textarea
          aria-describedby={state.errors?.text ? textErrorId : undefined}
          aria-invalid={Boolean(state.errors?.text)}
          defaultValue={post.text}
          id={textInputId}
          name="text"
          rows={4}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label className="wc-sr-only" htmlFor={ipInputId}>IP 채널</label>
          <select
            aria-describedby={state.errors?.ipId ? ipErrorId : undefined}
            aria-invalid={Boolean(state.errors?.ipId)}
            defaultValue={defaultIpId}
            disabled={!defaultIpId}
            id={ipInputId}
            name="ipId"
            style={{ ...selectStyle, flex: '0 1 auto', minWidth: 140 }}
          >
            {post.ipId && !currentIpIsActive && (
              <option value={post.ipId}>[보관] {post.ipName}</option>
            )}
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>{channel.title}</option>
            ))}
          </select>
          <label className="wc-sr-only" htmlFor={tagInputId}>태그</label>
          <input
            defaultValue={post.tag ?? ''}
            id={tagInputId}
            name="tag"
            placeholder="#태그"
            style={{ flex: 1, minWidth: 140, width: 'auto' }}
          />
        </div>
        {post.img && (
          <p style={{ color: 'var(--wc-ink-tertiary)', fontSize: 12.5, margin: 0 }}>기존 이미지는 그대로 유지돼요.</p>
        )}
        <ErrorText id={textErrorId}>{state.errors?.text}</ErrorText>
        <ErrorText id={ipErrorId}>{state.errors?.ipId}</ErrorText>
        <div id={formErrorId} role="alert" style={{ color: 'var(--wc-danger)', fontSize: 13, letterSpacing: '-0.38px' }}>
          {state.errors?.form ?? state.errors?.postId}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
          <button
            className="wc-btn"
            onClick={onCancel}
            style={{ fontSize: 15, padding: '0 18px', width: 'auto' }}
            type="button"
          >
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
    <article className="wc-community__post" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <span
          style={{
            alignItems: 'center',
            /* 아바타 색은 데이터가 낸다 — wc 크롬 색이 아니라 사용자 식별값. */
            background: p.avatar,
            borderRadius: '50%',
            color: 'var(--wc-ink)',
            display: 'inline-flex',
            flex: '0 0 auto',
            fontWeight: 700,
            height: 40,
            justifyContent: 'center',
            width: 40,
          }}
        >
          {p.user[0]?.toUpperCase()}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>@{p.user}</span>
          <span className="wc-community__meta">
            {p.ipName} · {p.time}{p.isEdited ? ' · 수정됨' : ''}
          </span>
        </div>
        <div
          className="wc-community__actions"
          style={{ justifyContent: 'flex-end', marginLeft: 'auto', marginTop: 0 }}
        >
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
              onClick={toggleEditor}
              style={{ ...textActionStyle, minWidth: 44 }}
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

      <p style={{ lineHeight: 1.65, margin: 0, textWrap: 'pretty', whiteSpace: 'pre-line' }}>{p.text}</p>

      {imageBackground && (
        <div style={{ display: 'flex', gap: 10 }}>
          <div
            style={{
              aspectRatio: '5 / 7',
              background: imageBackground,
              border: '1px solid var(--wc-hairline)',
              overflow: 'hidden',
              width: 132,
            }}
          />
        </div>
      )}

      <div className="wc-community__actions">
        <form action={setCommunityPostLikeAction}>
          <input type="hidden" name="next" value={nextPath} />
          <input type="hidden" name="postId" value={p.id} />
          <input type="hidden" name="shouldLike" value={p.likedByViewer ? '0' : '1'} />
          <LikeButton active={p.likedByViewer} likes={p.likes} />
        </form>
        <span style={{ cursor: 'default' }}>💬 {p.comments}</span>
        <span style={{ cursor: 'default', marginLeft: 'auto' }}>#{p.tag ?? '커뮤니티'}</span>
      </div>

      {p.commentItems.length > 0 && (
        <div className="wc-community__comments" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {p.commentItems.map((comment) => (
            <div key={comment.id} style={{ alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <span
                style={{
                  alignItems: 'center',
                  background: 'var(--wc-surface-grey)',
                  borderRadius: '50%',
                  color: 'var(--wc-ink-tertiary)',
                  display: 'inline-flex',
                  flex: '0 0 auto',
                  fontSize: 11,
                  fontWeight: 700,
                  height: 28,
                  justifyContent: 'center',
                  width: 28,
                }}
              >
                {comment.user[0]?.toUpperCase()}
              </span>
              <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <div style={{ alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>@{comment.user}</span>
                  <span className="wc-community__meta" style={{ fontSize: 11 }}>{comment.time}</span>
                </div>
                <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: 0 }}>{comment.text}</p>
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
    <button
      className="wc-btn primary"
      disabled={disabled || pending}
      style={{ flex: '0 0 auto', fontSize: 15, padding: '0 18px', width: 'auto' }}
      type="submit"
    >
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
      className="wc-community__trending"
      style={{ boxSizing: 'border-box', marginBottom: 20, maxWidth: '100%', minWidth: 0, width: '100%' }}
    >
      <h2
        id="community-trending-title"
        style={{ color: 'var(--wc-ink)', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, letterSpacing: '-0.4px', margin: 0 }}
      >
        최근 7일 트렌딩
      </h2>
      {normalizedTags.length > 0 ? (
        <div style={{ marginTop: 12, maxWidth: '100%', minWidth: 0, width: '100%' }}>
          {normalizedTags.map((tag) => (
            <Link
              key={tag}
              href={`/search?q=${encodeURIComponent(tag)}`}
              style={{ maxWidth: '100%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={`#${tag}`}
            >
              #{tag}
            </Link>
          ))}
        </div>
      ) : (
        <p style={{ color: 'var(--wc-ink-tertiary)', fontSize: 13, margin: '10px 0 0' }}>
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
  /* 파일 인풋은 wc-sr-only 로 숨겨 클립되므로, 키보드 포커스 링은 라벨에 상태로 그려 준다. */
  const [fileFocusRing, setFileFocusRing] = useState(false);
  const defaultIpId = channels.some((c) => c.id === selectedChannelId) ? selectedChannelId : channels[0]?.id ?? '';
  const disabled = !defaultIpId;

  return (
    <form
      action={action}
      className="wc-community__composer"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}
    >
      <input type="hidden" name="next" value={nextPath} />
      <div style={{ alignItems: 'center', display: 'grid', gap: 10, gridTemplateColumns: '40px minmax(0, 1fr) auto', minWidth: 0 }}>
        <span
          aria-hidden
          style={{ background: 'var(--wc-surface-grey)', border: '1px solid var(--wc-hairline)', borderRadius: '50%', height: 40, width: 40 }}
        />
        <input
          aria-describedby={state.errors?.text ? 'community-text-error' : undefined}
          aria-invalid={Boolean(state.errors?.text)}
          name="text"
          placeholder="오늘의 최애 소식을 들려주세요…"
        />
        <PostSubmitButton disabled={disabled} />
      </div>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
        <select
          key={defaultIpId}
          aria-describedby={state.errors?.ipId ? 'community-ip-error' : undefined}
          aria-invalid={Boolean(state.errors?.ipId)}
          defaultValue={defaultIpId}
          disabled={disabled}
          name="ipId"
          style={{ ...selectStyle, flex: '1 1 150px' }}
        >
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.title}</option>
          ))}
        </select>
        <input
          name="tag"
          placeholder="#태그"
          style={{ flex: '1 1 110px', width: 'auto' }}
        />
        <label
          htmlFor="community-composer-image"
          style={{
            alignItems: 'center',
            background: 'var(--wc-surface)',
            border: '1px solid var(--wc-line-control)',
            cursor: 'pointer',
            display: 'flex',
            flex: '2 1 190px',
            gap: 8,
            minHeight: 50,
            minWidth: 0,
            outline: fileFocusRing ? '2px solid var(--wc-focus)' : undefined,
            outlineOffset: fileFocusRing ? 2 : undefined,
            overflow: 'hidden',
            padding: '0 12px',
          }}
        >
          <span style={{ flex: '0 0 auto', fontSize: 12.5, fontWeight: 700 }}>이미지 추가</span>
          <span
            aria-live="polite"
            style={{ color: 'var(--wc-ink-tertiary)', fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {imageName || 'JPG · PNG · WEBP · GIF'}
          </span>
          <input
            aria-describedby={state.errors?.image ? 'community-image-error' : undefined}
            aria-invalid={Boolean(state.errors?.image)}
            className="wc-sr-only"
            accept="image/jpeg,image/png,image/webp,image/gif"
            id="community-composer-image"
            name="image"
            onBlur={() => setFileFocusRing(false)}
            onChange={(event) => setImageName(event.currentTarget.files?.[0]?.name ?? '')}
            onFocus={(event) => {
              let visible = true;
              try {
                visible = event.currentTarget.matches(':focus-visible');
              } catch {
                /* 지원하지 않는 브라우저에서는 포커스마다 링을 그린다. */
              }
              setFileFocusRing(visible);
            }}
            type="file"
          />
        </label>
      </div>
      <ErrorText id="community-ip-error">{state.errors?.ipId}</ErrorText>
      <ErrorText id="community-text-error">{state.errors?.text}</ErrorText>
      <ErrorText id="community-image-error">{state.errors?.image}</ErrorText>
      {state.errors?.form && (
        <div role="alert" style={{ color: 'var(--wc-danger)', fontSize: 13, fontWeight: 700 }}>
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
    <nav aria-label="커뮤니티 피드" className="wc-community__tabs">
      {tabs.map((tab) => {
        const active = feedScope === tab.scope;
        return (
          <Link
            key={tab.scope}
            aria-current={active ? 'page' : undefined}
            href={tab.href}
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
          sub: '온라인 팝업에서 최애를 팔로우하면 이곳에 이야기가 모여요.',
          href: '/ip',
          label: 'IP 둘러보기',
        };

  return (
    <div className="wc-community__gate">
      <EmptyState
        action={<WcButton href={state.href} variant="primary">{state.label}</WcButton>}
        description={state.sub}
        title={state.text}
      />
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
  const cardRewardsEnabled = useCardRewardsEnabled();
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

  const channelButton = (id: string, title: string) => {
    const active = channelId === id;
    return (
      <button
        key={id}
        aria-pressed={active}
        onClick={() => setSelectedChannelId(id)}
        type="button"
      >
        {title}
      </button>
    );
  };

  return (
    <div className="wc-root wc-community">
      <div className="wc-container">
        <header
          style={{ alignItems: 'flex-end', display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', margin: '0 0 20px' }}
        >
          <div>
            <p style={{ color: 'var(--wc-ink-tertiary)', fontSize: 12, fontWeight: 700, margin: 0 }}>떠들어요 · 팬덤 채널</p>
            <h1
              style={{ color: 'var(--wc-ink)', fontFamily: 'inherit', fontSize: 26, fontWeight: 700, letterSpacing: '-0.8px', lineHeight: 1.3, margin: '6px 0 0' }}
            >
              같은 최애, 같은 온도
            </h1>
          </div>
          <span style={{ color: 'var(--wc-ink-tertiary)', fontSize: 13 }}>지금 이야기 {snapshot.posts.length}개</span>
        </header>

        <TrendingTags tags={snapshot.trending} />
        <FeedScopeTabs feedScope={feedScope} />

        <div
          aria-label="팬덤 채널"
          className="wc-community__channels"
          role="group"
        >
          {channelButton('all', feedScope === 'fandom' ? '내 팬덤 전체' : '전체 피드')}
          {channels.map((c) => channelButton(c.id, c.title))}
        </div>

        <div className="wc-community__layout">
          <div style={{ minWidth: 0 }}>
            {fandomReady ? (
              <>
                {channels.length > 0 && (
                  <Composer channels={channels} nextPath={nextPath} selectedChannelId={channelId} />
                )}
                {posts.map((post) => (
                  <PostCard channels={channels} key={post.id} nextPath={nextPath} p={post} />
                ))}
                {!posts.length && feedScope === 'fandom' && channelId === 'all' ? (
                  <EmptyState
                    action={<WcButton href="/community">전체 피드 보기</WcButton>}
                    description={channels.length > 0
                      ? '위 컴포저에서 포스트를 쓰거나 전체 피드의 이야기를 둘러보세요.'
                      : '새 글은 운영 중인 IP를 팔로우한 뒤 작성할 수 있어요.'}
                    title={channels.length > 0 ? '내 팬덤의 첫 이야기를 남겨보세요' : '보관된 팬덤의 지난 이야기가 아직 없어요'}
                  />
                ) : !posts.length ? (
                  <EmptyState
                    description={channelId !== 'all' ? undefined : '첫 번째 포스트를 작성해보세요'}
                    title={channelId !== 'all'
                      ? `${channels.find((c) => c.id === channelId)?.title ?? ''} 채널의 첫 이야기를 남겨보세요`
                      : '아직 포스트가 없어요'}
                  />
                ) : null}
              </>
            ) : (
              <FandomGate viewerState={viewerState} />
            )}
          </div>

          <aside className="wc-community__rail">
            {feedScope === 'all' && ranking.length > 0 && (
              <div>
                <h2 style={{ color: 'var(--wc-ink-tertiary)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', margin: 0 }}>
                  팬덤 랭킹
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
                  {ranking.map((r, i) => (
                    <div key={r.name} style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
                      <span style={{ color: i === 0 ? 'var(--wc-ink)' : 'var(--wc-ink-tertiary)', flex: '0 0 auto', fontSize: 13, fontWeight: 700, width: 18 }}>
                        {i + 1}
                      </span>
                      <span aria-hidden style={{ background: r.avatar, borderRadius: '50%', flex: '0 0 auto', height: 30, width: 30 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        @{r.name}
                      </span>
                      <span style={{ color: 'var(--wc-ink-tertiary)', flex: '0 0 auto', fontSize: 11, marginLeft: 'auto' }}>♥ {r.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {cardRewardsEnabled && (
              <div>
                <h2 style={{ color: 'var(--wc-ink-tertiary)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', margin: 0 }}>
                  지금 열린 카드풀
                </h2>
                <p style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.5, margin: '10px 0 0' }}>
                  새 카드풀이 열려 있어요<br />오늘의 운을 시험해 보세요
                </p>
                <Link
                  className="wc-btn primary"
                  href={hrefFor('packs')}
                  style={{ fontSize: 14, marginTop: 14, padding: '0 16px', width: 'auto' }}
                >
                  카드팩 열기 →
                </Link>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
