const SHEET_STATES = ['collapsed', 'half', 'full'];
import { setTranslatedAttribute, setTranslatedText } from '../i18n/index.js';

export function nextSheetState(currentState, direction) {
  const currentIndex = Math.max(0, SHEET_STATES.indexOf(currentState));
  const nextIndex = Math.min(
    SHEET_STATES.length - 1,
    Math.max(0, currentIndex + Math.sign(direction)),
  );
  return SHEET_STATES[nextIndex];
}

export function cycleSheetState(currentState) {
  const currentIndex = Math.max(0, SHEET_STATES.indexOf(currentState));
  return SHEET_STATES[(currentIndex + 1) % SHEET_STATES.length];
}

function ensureSheetContentRegion(sheet) {
  let content = sheet.querySelector(':scope > .sheet-content');
  if (content) return content;
  const nestedContent = sheet.querySelector('.sheet-content');
  if (nestedContent) nestedContent.replaceWith(...nestedContent.childNodes);
  content = document.createElement('div');
  content.className = 'sheet-content';
  content.id = `${sheet.id || 'responsive-sheet'}-content`;
  const children = [...sheet.children].filter((child) => !child.classList.contains('sheet-handle'));
  for (const child of children) content.appendChild(child);
  sheet.appendChild(content);
  return content;
}

function setSheetState(sheet, state) {
  sheet.dataset.sheetState = SHEET_STATES.includes(state) ? state : 'half';
  const handle = sheet.querySelector('.sheet-handle');
  const content = ensureSheetContentRegion(sheet);
  if (!handle || !content) return;
  const collapsed = sheet.dataset.sheetState === 'collapsed';
  const nextState = cycleSheetState(sheet.dataset.sheetState);
  const labelKey = nextState === 'collapsed'
    ? 'sheet.collapse'
    : nextState === 'half'
      ? 'sheet.expandHalf'
      : 'sheet.expandFull';
  setTranslatedAttribute(handle, labelKey, 'aria-label');
  handle.setAttribute('aria-expanded', String(!collapsed));
  handle.setAttribute('aria-controls', content.id);
  content.inert = collapsed;
  content.setAttribute('aria-hidden', String(collapsed));
}

function addSheetHandle(sheet) {
  let handle = sheet.querySelector(':scope > .sheet-handle');
  if (!handle) {
    handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'sheet-handle';
    handle.innerHTML = '<span aria-hidden="true"></span>';
    handle.addEventListener('click', () => {
      setSheetState(sheet, cycleSheetState(sheet.dataset.sheetState));
    });
    sheet.prepend(handle);
  }
  ensureSheetContentRegion(sheet);
  setSheetState(sheet, sheet.dataset.sheetState);
}

function enhanceProgressiveSurface(id, label) {
  const surface = document.getElementById(id);
  if (!surface || surface.parentElement?.classList.contains('progressive-surface')) return;
  const details = document.createElement('details');
  details.className = 'progressive-surface';
  const summary = document.createElement('summary');
  setTranslatedText(summary, label);
  surface.before(details);
  details.append(summary, surface);
}

export function initShell() {
  const sheet = document.getElementById('sidepanel');
  if (sheet) addSheetHandle(sheet);
  enhanceProgressiveSurface('charts', 'sheet.viewDetails');
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initShell);
  else initShell();
}
