/** 화면이 새 칸을 그린 뒤에 포커스를 옮긴다(모양이 바뀌면 칸이 다음 커밋에야 생긴다 — 몇 프레임 기다린다). 브라우저 이벤트 안에서만 부른다. */
export function focusCheckoutElementWhenReady(id: string, frames = 5): void {
  window.requestAnimationFrame(() => {
    const element = document.getElementById(id);
    if (element) element.focus();
    else if (frames > 0) focusCheckoutElementWhenReady(id, frames - 1);
  });
}
