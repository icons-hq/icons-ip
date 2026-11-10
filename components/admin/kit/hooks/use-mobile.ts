import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/*
 * ICONS: the shadcn original set state inside an effect (react-hooks/set-state-in-effect). Reading the
 * media query through useSyncExternalStore gives the same answer without the extra render; the server
 * snapshot is "not mobile", like the original first render.
 */
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
