/**
 * 칸 이름 옆 "?" 도움말 한 건(docs/admin-screen-rules.md 규칙 3).
 *
 * 읽는 사람은 처음 보는 운영자다. 문장은 '~합니다'체로 한 문장에 한 가지만 말하고, 개발 용어를 쓰지 않는다.
 * 문구는 화면 파일이 아니라 `lib/admin/help/<화면>.ts`에 모아 둔다 — 같은 칸을 여러 화면이 같은 말로 설명하고,
 * 검사(`lib/admin/help/help-contract.test.ts`)가 형식과 쓰지 않는 표현을 한 번에 본다.
 */
export interface AdminHelp {
  /** 이 칸이 무엇인지. 한두 문장. */
  what: string;
  /** 언제 쓰는지. 쓰지 않아도 되는 경우를 함께 말한다. */
  when?: string;
  /** 넣은 값이 어디(고객 화면·주문서·엑셀·배송비)에 보이거나 쓰이는지. */
  where?: string;
  /** 넣는 값의 예. */
  example?: string;
  /** 꼭 알아야 할 주의(되돌릴 수 없음·함께 쓸 수 없는 설정). */
  caution?: string;
}

/** 도움말 묶음(화면 하나). 키는 화면 코드가 가리키는 이름이다. */
export type AdminHelpBook<K extends string = string> = Readonly<Record<K, AdminHelp>>;

/** 도움말 안에서 각 줄 앞에 붙는 이름. 화면과 검사가 같은 순서를 쓴다. */
export const ADMIN_HELP_PARTS = [
  ['when', '언제 쓰나요'],
  ['where', '어디에 보이나요'],
  ['example', '예시'],
  ['caution', '주의'],
] as const satisfies readonly (readonly [Exclude<keyof AdminHelp, 'what'>, string])[];
