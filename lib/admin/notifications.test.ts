import { describe, expect, it } from 'vitest';
import {
  adminNotificationAudienceFromRow,
  adminNotificationHistoryFromRow,
  normalizeAdminNotificationForm,
} from './notifications';

const OPERATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function notificationForm(entries: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('operationId', OPERATION_ID);
  formData.set('scope', 'all');
  formData.set('ipId', 'stale-ip');
  formData.set('title', '  서비스 점검 안내  ');
  formData.set('body', '  오늘 자정에 짧은 점검이 진행됩니다.  ');
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe('normalizeAdminNotificationForm', () => {
  it('전체 대상 입력의 공백을 정리하고 사용하지 않는 IP를 제거한다', () => {
    expect(normalizeAdminNotificationForm(notificationForm({ operationId: OPERATION_ID.toUpperCase() })))
      .toEqual({
        ok: true,
        value: {
          operationId: OPERATION_ID,
          scope: 'all',
          ipId: null,
          title: '서비스 점검 안내',
          body: '오늘 자정에 짧은 점검이 진행됩니다.',
        },
      });
  });

  it('IP 팔로워 대상에는 유효한 IP ID를 요구한다', () => {
    expect(normalizeAdminNotificationForm(notificationForm({ scope: 'ip_followers', ipId: '' })))
      .toEqual({
        ok: false,
        errors: { ipId: '발송할 IP를 선택해주세요.' },
      });

    expect(normalizeAdminNotificationForm(notificationForm({
      scope: 'ip_followers',
      ipId: 'rilakkuma',
    }))).toMatchObject({
      ok: true,
      value: { scope: 'ip_followers', ipId: 'rilakkuma' },
    });
  });

  it('operation ID, 대상, 제목과 본문의 서버 계약을 검증한다', () => {
    expect(normalizeAdminNotificationForm(notificationForm({
      operationId: 'not-a-uuid',
      scope: 'segment',
      title: 'x'.repeat(121),
      body: 'y'.repeat(501),
    }))).toEqual({
      ok: false,
      errors: {
        operationId: '올바른 발송 요청 ID가 필요합니다.',
        scope: '허용된 발송 대상을 선택해주세요.',
        title: '제목은 1자 이상 120자 이하로 입력해주세요.',
        body: '본문은 1자 이상 500자 이하로 입력해주세요.',
      },
    });
  });

  it('이모지의 UTF-16 길이가 아니라 사용자 문자 수로 제한을 계산한다', () => {
    const result = normalizeAdminNotificationForm(notificationForm({
      title: '🎉'.repeat(120),
      body: '📢'.repeat(500),
    }));

    expect(result.ok).toBe(true);
  });
});

describe('admin notification DB row mapping', () => {
  it('수신자 추정 bigint와 nullable IP를 UI DTO로 변환한다', () => {
    expect(adminNotificationAudienceFromRow({
      scope: 'all',
      ip_id: null,
      ip_title: null,
      recipient_count: '42',
      can_send: true,
    })).toEqual({
      scope: 'all',
      ipId: null,
      ipTitle: null,
      recipientCount: 42,
      canSend: true,
    });
  });

  it('감사 이력 행을 수신자 PII 없는 DTO로 변환한다', () => {
    expect(adminNotificationHistoryFromRow({
      operation_id: OPERATION_ID,
      actor_name: '운영자',
      scope: 'ip_followers',
      ip_id: 'rilakkuma',
      ip_title: '리락쿠마',
      title: '신규 카드팩 안내',
      body: '알림함에서 새 소식을 확인해주세요.',
      recipient_count: '9',
      sent_at: '2026-07-16T01:02:03.000Z',
    })).toEqual({
      operationId: OPERATION_ID,
      actorName: '운영자',
      scope: 'ip_followers',
      ipId: 'rilakkuma',
      ipTitle: '리락쿠마',
      title: '신규 카드팩 안내',
      body: '알림함에서 새 소식을 확인해주세요.',
      recipientCount: 9,
      sentAt: '2026-07-16T01:02:03.000Z',
    });
  });

  it('지원하지 않는 대상과 잘못된 수신자 수는 조용히 표시하지 않는다', () => {
    expect(() => adminNotificationAudienceFromRow({
      scope: 'unknown',
      ip_id: null,
      ip_title: null,
      recipient_count: 1,
      can_send: true,
    })).toThrow('Unsupported admin notification audience');

    expect(() => adminNotificationHistoryFromRow({
      operation_id: OPERATION_ID,
      actor_name: '운영자',
      scope: 'all',
      ip_id: null,
      ip_title: null,
      title: '제목',
      body: '본문',
      recipient_count: '-1',
      sent_at: '2026-07-16T01:02:03.000Z',
    })).toThrow('Invalid admin notification recipient count');
  });
});
