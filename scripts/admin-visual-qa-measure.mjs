/**
 * Browser-only, closure-free measurement entry point. Use with page.evaluate or
 * a read-only browser evaluator; this function does not click or change the DOM.
 */
export function measureAdminLayout(options = {}) {
  const tolerance = 2;
  const root = document.querySelector(options.rootSelector || '.wc-admin');
  const content = root?.querySelector('.admin-content') || root;
  const findings = [];
  const normal = (text) => (text || '').replace(/\s+/g, ' ').trim();
  const rounded = (value) => Math.round(value * 100) / 100;
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return Object.fromEntries(['x', 'y', 'width', 'height', 'left', 'top', 'right', 'bottom'].map((key) => [key, rounded(box[key])]));
  };
  const visible = (element) => {
    if (!element || !element.getClientRects().length) return false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0 || parent.hidden) return false;
      if (parent.tagName === 'DETAILS' && !parent.open && parent !== element) {
        const summary = [...parent.children].find((child) => child.tagName === 'SUMMARY');
        if (!summary?.contains(element)) return false;
      }
    }
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const describe = (element) => {
    const parts = [];
    for (let node = element; node && node !== root && parts.length < 5; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(`${part}#${CSS.escape(node.id)}`); break; }
      if (node.classList.length) part += `.${[...node.classList].slice(0, 2).map((name) => CSS.escape(name)).join('.')}`;
      const siblings = node.parentElement ? [...node.parentElement.children].filter((child) => child.tagName === node.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const label = (element) => normal(element.getAttribute('aria-label') || (element.labels && [...element.labels].map((entry) => entry.textContent).join(' ')) || element.getAttribute('placeholder') || element.textContent).slice(0, 160);
  const add = (code, message, element, geometry = {}, severity = 'error') => findings.push({ code, severity, message, selector: element ? describe(element) : null, label: element ? label(element) : null, ...geometry });
  const number = (value) => Number.parseFloat(value) || 0;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const textWidth = (text, style) => {
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return context.measureText(text).width + Math.max(0, text.length - 1) * number(style.letterSpacing);
  };
  const headings = root ? [...root.querySelectorAll(options.headingSelector || 'h1, h2')].filter(visible).map((element) => normal(element.textContent)) : [];
  const expected = Array.isArray(options.heading) ? options.heading : [options.heading].filter(Boolean);
  const meaningfulText = normal(content?.innerText);
  const overlaySelectors = ['nextjs-portal', 'vite-error-overlay', '#webpack-dev-server-client-overlay', '[data-nextjs-dialog-overlay]'];
  const overlays = overlaySelectors.filter((selector) => [...document.querySelectorAll(selector)].some((element) => visible(element) && (element.shadowRoot?.querySelector('[data-nextjs-dialog], [data-nextjs-error-message]') || /error|오류|exception/i.test(element.textContent || '') || selector !== 'nextjs-portal')));
  const errorHeading = headings.find((heading) => /^(404|500|not found|application error|internal server error|페이지를 찾을 수|오류가 발생|접근 권한)/i.test(heading));
  const loginPurpose = /(?:로그인(?:하기)?|(?:sign|log)[ -]?in)\s*$/i;
  const passwordLogin = [...document.querySelectorAll('input[type="password"]')].filter(visible).some((password) => {
    const scope = password.closest('form, [role="form"], dialog, [role="dialog"]') || password.parentElement;
    const action = scope.getAttribute('action');
    const loginAction = action && /(?:^|\/)(login|sign-in|signin)(?:[/?#]|$)/i.test(action);
    return Boolean(loginAction) || [...scope.querySelectorAll('h1, h2, h3, [role="heading"], button, input[type="submit"]')].filter(visible).some((element) => loginPurpose.test(normal(element.textContent || element.value)));
  });
  const login = /\/(login|sign-in|signin)(\/|$)/i.test(location.pathname) || passwordLogin;
  const identity = {
    url: `${location.origin}${location.pathname}${location.search}`, title: document.title,
    rootFound: Boolean(root), headings, expected, headingMatched: expected.length > 0 && expected.some((heading) => headings.includes(heading)),
    contentCharacters: meaningfulText.length, login, overlays, errorHeading: errorHeading || null,
  };
  if (!root) add('identity-root', 'Expected admin root is absent. Login, 404, and public pages do not count as coverage.');
  if (!identity.headingMatched) add('identity-heading', 'Expected exact admin heading was not rendered.', null, { expected, actual: headings });
  if (meaningfulText.length < (options.minContentCharacters ?? 24)) add('identity-blank', 'Admin content is empty or has not reached a meaningful screen.');
  if (login) add('identity-login', 'Authentication UI was rendered instead of the requested admin screen.');
  if (overlays.length || errorHeading) add('identity-error', 'Framework or page error UI was rendered.', null, { overlays, errorHeading });
  const documentGeometry = { viewportWidth: innerWidth, viewportHeight: innerHeight, clientWidth: document.documentElement.clientWidth, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) };
  if (documentGeometry.scrollWidth > documentGeometry.clientWidth + tolerance) add('document-overflow', 'The entire page scrolls horizontally.', null, documentGeometry);
  if (!root) return { identity, document: documentGeometry, counts: { controls: 0, measuredElements: 0, fullValueHints: 0 }, controls: [], fullValueHints: [], intentionalScrollers: [], findings };

  const elements = [...root.querySelectorAll('*')].filter(visible);
  const intentionalScrollers = elements.filter((element) => {
    const style = getComputedStyle(element);
    return ['auto', 'scroll'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + tolerance;
  }).map((element) => ({ selector: describe(element), rect: rect(element), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, containsTable: Boolean(element.querySelector('table, [role="grid"]')) }));
  const scrollParent = (element) => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (['auto', 'scroll'].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth + tolerance) return parent;
    }
    return null;
  };
  const controlElements = elements.filter((element) => element.matches('input:not([type="hidden"]), select, textarea, button, summary, a.btn, [role="button"]'));
  const controls = [];
  const fullValueHints = [];
  const readableSelectionHint = (control, selectedText) => {
    const controlBox = rect(control);
    const expectedText = normal(selectedText);
    for (const id of (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)) {
      const hint = document.getElementById(id);
      if (!hint || hint === control || hint.contains(control) || !root.contains(hint) || !visible(hint) || normal(hint.innerText) !== expectedText) continue;
      const hintBox = rect(hint);
      const hintStyle = getComputedStyle(hint);
      const horizontalOverlap = Math.min(controlBox.right, hintBox.right) - Math.max(controlBox.left, hintBox.left);
      if (hintBox.top < controlBox.bottom - tolerance || hintBox.top > controlBox.bottom + 32 || horizontalOverlap < Math.min(24, controlBox.width / 2)) continue;
      if (number(hintStyle.fontSize) < 10) continue;
      let clipped = false;
      for (let ancestor = hint; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (ancestor.getAttribute('aria-hidden') === 'true' || style.clipPath !== 'none' || style.clip !== 'auto') clipped = true;
      }
      const textRects = [];
      const walker = document.createTreeWalker(hint, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!normal(node.textContent)) continue;
        const style = getComputedStyle(node.parentElement);
        if (!visible(node.parentElement) || number(style.fontSize) < 10 || /rgba\([^)]*,\s*0\s*\)/.test(style.color) || style.color === 'transparent') { clipped = true; continue; }
        const range = document.createRange(); range.selectNodeContents(node);
        for (const fragment of range.getClientRects()) {
          if (fragment.width <= 0 || fragment.height <= 0) continue;
          textRects.push(fragment);
          if (fragment.left < hintBox.left - tolerance || fragment.right > hintBox.right + tolerance || fragment.top < hintBox.top - tolerance || fragment.bottom > hintBox.bottom + tolerance) clipped = true;
          for (let ancestor = hint; ancestor; ancestor = ancestor.parentElement) {
            const ancestorStyle = getComputedStyle(ancestor); const boundary = ancestor.getBoundingClientRect();
            if (['auto', 'scroll', 'hidden', 'clip'].includes(ancestorStyle.overflowX) && (fragment.left < boundary.left + ancestor.clientLeft - tolerance || fragment.right > boundary.left + ancestor.clientLeft + ancestor.clientWidth + tolerance)) clipped = true;
            // The document's scrollable viewport is not a clipping ancestor for
            // content below the fold. Inner scrollports and actual hidden/clip
            // boundaries still need their full vertical containment check.
            const documentScrolling = (ancestor === document.documentElement || ancestor === document.body) && ['auto', 'scroll'].includes(ancestorStyle.overflowY);
            if (!documentScrolling && ['auto', 'scroll', 'hidden', 'clip'].includes(ancestorStyle.overflowY) && (fragment.top < boundary.top + ancestor.clientTop - tolerance || fragment.bottom > boundary.top + ancestor.clientTop + ancestor.clientHeight + tolerance)) clipped = true;
          }
          for (const x of [fragment.left + 1, (fragment.left + fragment.right) / 2, fragment.right - 1]) {
            const y = (fragment.top + fragment.bottom) / 2;
            // Elements below the document viewport remain reachable by scrolling.
            if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) continue;
            const hit = document.elementFromPoint(x, y);
            if (hit && !hint.contains(hit) && !hit.contains(hint)) clipped = true;
          }
        }
      }
      if (!clipped && textRects.length) return { selector: describe(control), hintSelector: describe(hint), rect: controlBox, hintRect: hintBox, textLength: expectedText.length };
    }
    return null;
  };
  for (const element of controlElements) {
    const box = rect(element);
    const style = getComputedStyle(element);
    const inset = number(style.paddingLeft) + number(style.paddingRight) + number(style.borderLeftWidth) + number(style.borderRightWidth);
    const kind = element.tagName.toLowerCase();
    const type = element.getAttribute('type') || 'text';
    const contentWidth = box.width - inset;
    const measurement = { selector: describe(element), label: label(element), kind, type, rect: box, contentWidth: rounded(contentWidth), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    controls.push(measurement);
    const embeddedStorefrontPreview = Boolean(element.closest('.wc-pdp.is-embedded'));
    if (!embeddedStorefrontPreview && element.matches('input, textarea, select') && !['checkbox', 'radio', 'color', 'range', 'file', 'image', 'submit', 'reset', 'button'].includes(type)) {
      // A useful editing aperture, based on this rendered font and control type.
      // Long input values are allowed to scroll; their full value is never logged.
      const sample = ['number', 'time'].includes(type) ? '00000' : ['date', 'datetime-local', 'month', 'week'].includes(type) ? '0000-00-00' : kind === 'select' ? '전체' : '가나다라마바';
      const minimum = textWidth(sample, style) + (kind === 'select' || ['date', 'datetime-local', 'month', 'week', 'time'].includes(type) ? 24 : 0);
      measurement.minimumContentWidth = rounded(minimum);
      if (contentWidth < minimum - tolerance) add('field-narrow', 'Control has too little visible editing space for its type and font.', element, { rect: box, contentWidth: rounded(contentWidth), minimumContentWidth: rounded(minimum), sample });
      if (box.height < 40 - tolerance) add('field-height', 'Admin input height is below the 40 px kit contract.', element, { rect: box, minimumHeight: 40 });
    }
    if (!embeddedStorefrontPreview && kind === 'input' && ['text', 'search'].includes(type) && !element.value && element.placeholder && (type === 'search' || /검색|search/i.test(`${label(element)} ${element.name}`))) {
      const required = textWidth(element.placeholder, style);
      if (required > contentWidth + tolerance) add('search-placeholder-clipped', 'Empty search control cuts off its search hint.', element, { rect: box, availableTextWidth: rounded(contentWidth), requiredTextWidth: rounded(required) }, [...element.placeholder].length <= 24 ? 'error' : 'warning');
    }
    if (kind === 'select' && !element.multiple && element.size <= 1) {
      const selectedText = element.selectedOptions[0]?.textContent || '';
      const required = textWidth(selectedText, style) + 24;
      if (required > contentWidth + tolerance) {
        const hint = readableSelectionHint(element, selectedText);
        if (hint) {
          fullValueHints.push(hint);
          add('select-full-value-readable', 'Native selection is truncated, but its linked adjacent hint visibly renders the complete value.', element, hint, 'info');
        } else add('control-text-clipped', 'Selected option cannot fit beside the native select indicator and has no fully readable adjacent described hint.', element, { rect: box, availableTextWidth: rounded(contentWidth - 24), requiredTextWidth: rounded(required - 24) });
      }
    } else if (element.matches('button, summary, a.btn, [role="button"]')) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const textRects = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!normal(node.textContent) || !visible(node.parentElement) || node.parentElement.closest('svg, [aria-hidden="true"]')) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const fragment of range.getClientRects()) textRects.push(fragment);
      }
      const clipped = textRects.some((fragment) => fragment.left < box.left - tolerance || fragment.right > box.right + tolerance || fragment.top < box.top - tolerance || fragment.bottom > box.bottom + tolerance);
      if (clipped) add('control-text-clipped', 'Action text extends outside its control.', element, { rect: box, textRects: textRects.map((fragment) => ({ left: rounded(fragment.left), right: rounded(fragment.right), top: rounded(fragment.top), bottom: rounded(fragment.bottom) })) });
      if (element.scrollWidth > element.clientWidth + tolerance && ['hidden', 'clip'].includes(style.overflowX) && style.textOverflow !== 'ellipsis') add('control-content-clipped', 'Action content is clipped by its own overflow rule.', element, { rect: box, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth });
    }
    if (!scrollParent(element) && (box.left < -tolerance || box.right > documentGeometry.clientWidth + tolerance)) add('control-outside-page', 'Control leaves the page viewport without an intentional scroll container.', element, { rect: box });
    // Parent clipping can hide a correctly sized control without body overflow.
    for (let parent = element.parentElement; parent && parent !== root.parentElement; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      if (['auto', 'scroll'].includes(parentStyle.overflowX)) break;
      if (!['hidden', 'clip'].includes(parentStyle.overflowX)) continue;
      const boundary = rect(parent);
      if (box.left < boundary.left - tolerance || box.right > boundary.right + tolerance) {
        add('control-parent-clipped', 'An ancestor cuts off the control horizontally.', element, { rect: box, clippingAncestor: describe(parent), boundary }); break;
      }
    }
  }
  // Keep full geometry above for controls reachable by scrolling. Collision
  // checks alone use painted intersections so offscreen list rows cannot collide
  // with the form below their scrollport.
  const collisionRect = (element) => {
    const box = rect(element);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent); const boundary = parent.getBoundingClientRect();
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
        box.left = Math.max(box.left, boundary.left + parent.clientLeft);
        box.right = Math.min(box.right, boundary.left + parent.clientLeft + parent.clientWidth);
      }
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
        box.top = Math.max(box.top, boundary.top + parent.clientTop);
        box.bottom = Math.min(box.bottom, boundary.top + parent.clientTop + parent.clientHeight);
      }
    }
    return { left: rounded(box.left), top: rounded(box.top), right: rounded(box.right), bottom: rounded(box.bottom), width: rounded(Math.max(0, box.right - box.left)), height: rounded(Math.max(0, box.bottom - box.top)) };
  };
  const collisionCandidates = controlElements.filter((element) => content?.contains(element)).map((element) => ({ element, visibleRect: collisionRect(element) })).filter(({ visibleRect }) => visibleRect.width > tolerance && visibleRect.height > tolerance);
  for (let leftIndex = 0; leftIndex < collisionCandidates.length; leftIndex++) {
    const { element: left, visibleRect: a } = collisionCandidates[leftIndex];
    for (const { element: right, visibleRect: b } of collisionCandidates.slice(leftIndex + 1)) {
      if (left.contains(right) || right.contains(left)) continue;
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (width > tolerance && height > tolerance) add('control-collision', 'Painted portions of separate controls overlap.', left, { rect: rect(left), visibleRect: a, otherSelector: describe(right), otherLabel: label(right), otherRect: rect(right), otherVisibleRect: b, overlap: { width: rounded(width), height: rounded(height) } });
    }
  }
  for (const element of elements.filter((element) => element.matches('label, .wc-admin-kit__field-label, .admin-console-filter-label') && !element.querySelector('input, select, textarea'))) {
    const box = rect(element); const style = getComputedStyle(element); const text = normal(element.textContent);
    if (text.length >= 4 && box.width < number(style.fontSize) * 3.5 && box.height > (number(style.lineHeight) || number(style.fontSize) * 1.5) * 1.8) add('label-fragmented', 'Label wraps into a very narrow vertical column.', element, { rect: box, fontSize: style.fontSize, lineHeight: style.lineHeight });
  }
  return { identity, document: documentGeometry, counts: { controls: controls.length, measuredElements: elements.length, fullValueHints: fullValueHints.length }, controls, fullValueHints, intentionalScrollers, findings };
}
