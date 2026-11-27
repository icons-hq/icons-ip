/**
 * 저장을 눌렀는데 빈 칸·잘못된 칸이 있으면 첫 번째 칸으로 포커스를 옮긴다. 창이 길면 오류 문구가 화면 밖에 있어, 눌러도 아무 일 없는 것처럼 보이지 않게 한다.
 * 오류는 다음 그리기에서 칸에 `aria-invalid`로 붙으므로 그린 다음 프레임에 찾는다. 훅을 쓰지 않는다(화면 부품의 훅 순서를 바꾸지 않고 붙일 수 있다).
 * `root`는 그 폼(또는 창) 안의 요소다. 브라우저가 아니거나 잘못된 칸이 없으면 아무것도 하지 않는다.
 */
export function focusFirstInvalid(root: ParentNode | null | undefined): void {
  if (!root || typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    root.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus();
  });
}
