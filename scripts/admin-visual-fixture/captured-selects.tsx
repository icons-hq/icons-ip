import { createElement, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminSelect } from '../../components/admin/console/AdminSelect';

const BOOLEAN_ATTRIBUTES = new Set([
  'autofocus', 'disabled', 'formnovalidate', 'multiple', 'required', 'selected',
]);
const ATTRIBUTE_PROPS: Record<string, string> = {
  autofocus: 'autoFocus',
  formnovalidate: 'formNoValidate',
  maxlength: 'maxLength',
  minlength: 'minLength',
  readonly: 'readOnly',
  tabindex: 'tabIndex',
};

function styleObject(select: HTMLSelectElement): CSSProperties | undefined {
  if (!select.style.length) return undefined;
  const style: Record<string, string> = {};
  for (const property of [...select.style]) {
    const key = property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    style[key] = select.style.getPropertyValue(property);
  }
  return style as CSSProperties;
}

function propsFromNativeSelect(select: HTMLSelectElement) {
  const props: Record<string, unknown> = {
    defaultValue: select.value,
  };
  for (const attribute of [...select.attributes]) {
    const attributeName = attribute.name;
    if (attributeName === 'style') {
      props.style = styleObject(select);
      continue;
    }
    const propName = ATTRIBUTE_PROPS[attributeName] || (attributeName === 'class' ? 'className' : attributeName);
    props[propName] = BOOLEAN_ATTRIBUTES.has(attributeName) ? true : attribute.value;
  }
  return props;
}

function optionsFromNativeSelect(select: HTMLSelectElement) {
  return [...select.options].map((option, index) => createElement(
    'option',
    {
      'aria-disabled': option.getAttribute('aria-disabled') || undefined,
      disabled: option.disabled || undefined,
      key: `${option.value}-${index}`,
      value: option.value,
    },
    option.textContent,
  ));
}

function replayableSelects() {
  const selectors = [
    '.wc-admin-kit__field > select.admin-field-control',
    '.admin-console-filter-field > select[id$="-status"]',
    '.admin-console-filter-search-row > select',
  ];
  return [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll<HTMLSelectElement>(selector)]))];
}

function mountSelect(select: HTMLSelectElement) {
  const parent = select.parentElement;
  if (!parent) return null;
  const host = document.createElement('span');
  const wrapperClassName = parent.classList.contains('admin-console-filter-search-row')
    ? 'admin-console-filter-select'
    : undefined;
  if (wrapperClassName) host.className = wrapperClassName;
  host.style.display = 'block';
  host.style.minWidth = '0';
  host.dataset.adminSelectReplayMount = 'true';
  parent.replaceChild(host, select);
  const props = propsFromNativeSelect(select);
  const root = createRoot(host);
  root.render(createElement(
    AdminSelect,
    { ...props, wrapperClassName, wrapperStyle: { display: 'contents' } },
    optionsFromNativeSelect(select),
  ));
  return root;
}

function mountCapturedSelects() {
  const roots = replayableSelects().map(mountSelect).filter(Boolean);
  document.body.dataset.adminVisualReplay = 'captured-components';
  document.body.dataset.adminVisualReplaySelectCount = String(roots.length);
  const markReadyAfterMeasurement = () => {
    const measured = document.querySelectorAll('[data-admin-select-replay-mount] select[data-admin-select-measured="true"]').length;
    if (measured < roots.length) {
      requestAnimationFrame(markReadyAfterMeasurement);
      return;
    }
    document.body.dataset.ready = 'true';
    document.body.dataset.adminSelectReplayReady = 'true';
  };
  requestAnimationFrame(markReadyAfterMeasurement);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountCapturedSelects, { once: true });
else mountCapturedSelects();
