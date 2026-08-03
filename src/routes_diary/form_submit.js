import Ajv from 'ajv';
import { submitDiary } from '../api/diary.js';
import { getSegmentDisplayLabel } from './labels.js';
import {
  clearRatingDraft,
  createRatingDraft,
  saveRatingDraft,
  selectLowestRatedSegments,
  setSegmentOverride,
  validateRatingStep,
} from './rating_flow.js';
import { onLanguageChange, setTranslatedAttribute, setTranslatedText, t } from '../i18n/index.js';

const ALL_TAGS = [
  'poor_lighting',
  'low_foot_traffic',
  'cars_too_close',
  'construction_blockage',
  'strangers_loitering',
  'no_sidewalk',
  'bike_conflict',
  'speeding_cars',
  'blocked_crosswalk',
  'potholes',
  'other',
  'dogs',
];
const DEFAULT_TAG_CHIPS = ['poor_lighting', 'low_foot_traffic', 'cars_too_close', 'construction_blockage', 'dogs', 'other'];
const STEP_ORDER = ['overall', 'details', 'segments'];
const STEP_TITLE_KEYS = {
  overall: 'rating.step.overall',
  details: 'rating.step.details',
  segments: 'rating.step.segments',
};

function translatedTagLabel(tag) {
  const key = `tag.${String(tag || '').trim().toLowerCase()}`;
  const translated = t(key);
  return translated === key ? String(tag || '').replace(/_/g, ' ') : translated;
}

function localizeRatingError(message) {
  const keys = {
    'Select an overall rating.': 'rating.selectOverall',
    'Pick at least one tag.': 'rating.pickOneTag',
    'Select at most three tags.': 'rating.maxTags',
    'Select a rating from 1 to 5.': 'rating.selectOneToFive',
    'Only two segment overrides are supported.': 'rating.maxOverrides',
  };
  return keys[message] ? t(keys[message]) : message;
}

const ajv = new Ajv({ allErrors: true });
const ratingSchema = {
  type: 'object',
  required: ['route_id', 'segment_ids', 'overall_rating', 'tags', 'mode', 'user_hash'],
  properties: {
    route_id: { type: 'string', minLength: 1 },
    segment_ids: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    overall_rating: { type: 'integer', minimum: 1, maximum: 5 },
    tags: {
      type: 'array',
      items: { type: 'string', enum: ALL_TAGS },
      minItems: 1,
      maxItems: 3,
    },
    segment_overrides: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        required: ['segment_id', 'rating'],
        properties: {
          segment_id: { type: 'string', minLength: 1 },
          rating: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
      default: [],
    },
    mode: { type: 'string', enum: ['walk', 'bike'] },
    user_hash: { type: 'string', minLength: 3 },
    notes: { type: 'string', maxLength: 200 },
    timestamp: { type: 'string' },
  },
};
const validatePayload = ajv.compile(ratingSchema);

let activeBackdrop = null;
let activeModal = null;
let activeBody = null;
let activeStepLabel = null;
let errorEl = null;
let submitBtn = null;
let escapeHandler = null;
let currentState = null;
let activeOpener = null;
let backgroundInertState = [];
let releaseLanguageChange = null;

export function submitSegmentFeedback(payload, { submit = submitDiary, signal } = {}) {
  const segmentId = String(payload?.segmentId || '').trim();
  const rating = Number(payload?.rating);
  return submit({
    segment_ids: segmentId ? [segmentId] : [],
    overall_rating: rating,
    tags: Array.isArray(payload?.tags) ? payload.tags : [],
    segment_overrides: segmentId ? [{ segment_id: segmentId, rating }] : [],
    mode: 'walk',
  }, { signal });
}

function persistDraft(state = currentState) {
  if (!state?.routeId) return;
  saveRatingDraft(state.routeId, {
    step: state.step,
    overallRating: state.overallRating,
    tags: state.tags,
    notes: state.notes,
    overrides: state.overrides,
  });
}

export function openRatingModal({ routeFeature, segmentLookup, userHash, onSuccess, signal }) {
  if (!routeFeature) return;
  closeRatingModal();
  if (typeof document === 'undefined') return;
  activeOpener = document.activeElement;

  const routeId = String(routeFeature.properties?.route_id || '');
  const draft = createRatingDraft(routeId);
  currentState = {
    route: routeFeature,
    routeId,
    segmentLookup: segmentLookup || new Map(),
    userHash,
    step: draft.step,
    tags: new Set(draft.tags),
    overrides: new Map(draft.overrides),
    overallRating: draft.overallRating,
    notes: draft.notes,
    onSuccess,
    signal,
    pending: false,
    clearDraft: () => clearRatingDraft(routeId),
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'diary-modal-backdrop';
  backdrop.addEventListener('click', closeRatingModal);

  const modal = document.createElement('form');
  modal.className = 'diary-modal-card';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'diary-rating-title');
  modal.tabIndex = -1;
  modal.addEventListener('click', (event) => event.stopPropagation());
  modal.addEventListener('submit', handleSubmit);

  const header = document.createElement('div');
  header.className = 'diary-modal-header';
  const titleRow = document.createElement('div');
  titleRow.className = 'diary-modal-title-row';
  const title = document.createElement('h2');
  title.id = 'diary-rating-title';
  title.className = 'diary-modal-title';
  setTranslatedText(title, 'rating.title');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'diary-modal-close';
  setTranslatedAttribute(closeBtn, 'rating.close', 'aria-label');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeRatingModal);
  titleRow.appendChild(title);
  titleRow.appendChild(closeBtn);
  header.appendChild(titleRow);

  activeStepLabel = document.createElement('div');
  activeStepLabel.className = 'diary-step-label';
  header.appendChild(activeStepLabel);
  const subtitle = document.createElement('p');
  subtitle.className = 'diary-modal-subtitle';
  subtitle.textContent = `${routeFeature.properties?.from || t('rating.origin')} → ${routeFeature.properties?.to || t('rating.destination')}`;
  header.appendChild(subtitle);
  modal.appendChild(header);

  activeBody = document.createElement('div');
  activeBody.className = 'diary-modal-body';
  modal.appendChild(activeBody);
  errorEl = document.createElement('div');
  errorEl.className = 'diary-error';
  errorEl.setAttribute('role', 'alert');
  modal.appendChild(errorEl);

  activeBackdrop = backdrop;
  activeModal = modal;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  setBackgroundInert(backdrop);
  renderCurrentStep();
  releaseLanguageChange = onLanguageChange(() => renderCurrentStep());

  escapeHandler = (event) => {
    if (event.key === 'Escape') closeRatingModal();
    if (event.key === 'Tab') trapModalFocus(event);
  };
  document.addEventListener('keydown', escapeHandler);
  closeBtn.focus?.();
}

export function closeRatingModal() {
  const opener = activeOpener;
  activeBackdrop?.remove();
  activeModal?.remove();
  if (escapeHandler && typeof document !== 'undefined') document.removeEventListener('keydown', escapeHandler);
  restoreBackgroundInert();
  releaseLanguageChange?.();
  releaseLanguageChange = null;
  activeBackdrop = null;
  activeModal = null;
  activeBody = null;
  activeStepLabel = null;
  errorEl = null;
  submitBtn = null;
  escapeHandler = null;
  currentState = null;
  activeOpener = null;
  if (opener?.isConnected !== false) opener?.focus?.();
}

function setBackgroundInert(backdrop) {
  backgroundInertState = Array.from(document.body.children)
    .filter((element) => element !== backdrop)
    .map((element) => ({ element, inert: element.inert }));
  backgroundInertState.forEach(({ element }) => {
    element.inert = true;
  });
}

function restoreBackgroundInert() {
  backgroundInertState.forEach(({ element, inert }) => {
    element.inert = inert;
  });
  backgroundInertState = [];
}

function trapModalFocus(event) {
  if (!activeModal) return;
  const focusable = Array.from(activeModal.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.tabIndex >= 0);
  if (focusable.length === 0) {
    event.preventDefault();
    activeModal.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (!activeModal.contains(document.activeElement) || document.activeElement === first)) {
    event.preventDefault();
    focusable[focusable.length - 1].focus();
  } else if (!event.shiftKey && (!activeModal.contains(document.activeElement) || document.activeElement === last)) {
    event.preventDefault();
    focusable[0].focus();
  }
}

export function finalizeDiarySubmission({
  state,
  payload,
  response,
  close = closeRatingModal,
  isCurrent = () => true,
}) {
  if (state?.signal?.aborted || !isCurrent()) return false;
  const onSuccess = state?.onSuccess;
  state?.clearDraft?.();
  close();
  onSuccess?.({ payload, response });
  return true;
}

function renderCurrentStep(focusTarget = null) {
  const state = currentState;
  if (!state || !activeBody || !activeModal) return;
  setError('');
  activeBody.replaceChildren();
  activeModal.querySelector?.('.diary-modal-footer')?.remove();
  const stepIndex = STEP_ORDER.indexOf(state.step);
  setTranslatedText(activeStepLabel, 'rating.step', {
    current: stepIndex + 1,
    title: t(STEP_TITLE_KEYS[state.step]),
  });

  if (state.step === 'overall') activeBody.appendChild(createStarSelector(state));
  if (state.step === 'details') {
    activeBody.appendChild(createTagSelector(state));
    activeBody.appendChild(createNotesSection(state));
  }
  if (state.step === 'segments') activeBody.appendChild(createSegmentOverrideSection(state));
  activeModal.appendChild(createFooter(state));
  restoreRerenderFocus(focusTarget);
}

function restoreRerenderFocus(focusTarget) {
  if (!focusTarget || !activeBody) return;
  if (focusTarget.type === 'step') {
    const selector = {
      overall: '[role="radio"][tabindex="0"]',
      details: '.diary-tag',
      segments: 'input[type="checkbox"]',
    }[focusTarget.value];
    activeBody.querySelector(selector)?.focus?.();
    return;
  }
  const target = Array.from(activeBody.querySelectorAll('[data-focus-type]')).find((element) => (
    element.dataset.focusType === focusTarget.type && element.dataset.focusValue === focusTarget.value
  ));
  if (target) target.focus?.();
  else if (focusTarget.type === 'tag') activeBody.querySelector('[data-role="add-tag"]')?.focus?.();
}

function createHeading(titleKey, descriptionKey) {
  const wrapper = document.createElement('div');
  const heading = document.createElement('h3');
  heading.className = 'diary-form-heading-title';
  setTranslatedText(heading, titleKey);
  const hint = document.createElement('p');
  hint.className = 'diary-form-heading-hint';
  setTranslatedText(hint, descriptionKey);
  wrapper.appendChild(heading);
  wrapper.appendChild(hint);
  return wrapper;
}

function createStarSelector(state) {
  const wrapper = createHeading('rating.overallTitle', 'rating.overallHint');
  const row = document.createElement('div');
  row.className = 'diary-stars';
  row.setAttribute('role', 'radiogroup');
  setTranslatedAttribute(row, 'rating.overallAria', 'aria-label');
  for (let rating = 1; rating <= 5; rating += 1) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'diary-star';
    star.textContent = '★';
    star.dataset.focusType = 'star';
    star.dataset.focusValue = String(rating);
    star.setAttribute('role', 'radio');
    setTranslatedAttribute(star, rating === 1 ? 'rating.starOne' : 'rating.starMany', 'aria-label', { count: rating });
    star.setAttribute('aria-checked', String(rating === state.overallRating));
    star.tabIndex = rating === (state.overallRating || 1) ? 0 : -1;
    star.classList.toggle('is-filled', rating <= (state.overallRating || 0));
    star.addEventListener('click', () => selectStarRating(state, rating));
    star.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextRating = rating;
      if (event.key === 'Home') nextRating = 1;
      else if (event.key === 'End') nextRating = 5;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextRating = rating === 5 ? 1 : rating + 1;
      else nextRating = rating === 1 ? 5 : rating - 1;
      selectStarRating(state, nextRating);
    });
    row.appendChild(star);
  }
  wrapper.appendChild(row);
  return wrapper;
}

function selectStarRating(state, rating) {
  state.overallRating = rating;
  persistDraft(state);
  renderCurrentStep({ type: 'star', value: String(rating) });
}

function createTagSelector(state) {
  const wrapper = createHeading('rating.tagsTitle', 'rating.tagsHint');
  const chips = document.createElement('div');
  chips.className = 'diary-tag-list';
  const visibleTags = [...new Set([...DEFAULT_TAG_CHIPS, ...state.tags])];
  visibleTags.forEach((tag) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'diary-tag';
    chip.textContent = translatedTagLabel(tag);
    chip.dataset.focusType = 'tag';
    chip.dataset.focusValue = tag;
    chip.setAttribute('aria-pressed', String(state.tags.has(tag)));
    chip.addEventListener('click', () => {
      if (state.tags.has(tag)) state.tags.delete(tag);
      else if (state.tags.size < 3) state.tags.add(tag);
      else {
        setError(t('rating.maxTags'));
        return;
      }
      persistDraft(state);
      renderCurrentStep({ type: 'tag', value: tag });
    });
    chips.appendChild(chip);
  });
  wrapper.appendChild(chips);

  const select = document.createElement('select');
  select.className = 'diary-field';
  select.dataset.role = 'add-tag';
  setTranslatedAttribute(select, 'rating.addTag', 'aria-label');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  setTranslatedText(placeholder, 'rating.addTagOption');
  placeholder.selected = true;
  placeholder.disabled = true;
  select.appendChild(placeholder);
  ALL_TAGS.filter((tag) => !state.tags.has(tag)).forEach((tag) => {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = translatedTagLabel(tag);
    select.appendChild(option);
  });
  select.disabled = state.tags.size >= 3;
  select.addEventListener('change', () => {
    const tag = select.value;
    if (tag && state.tags.size < 3) state.tags.add(tag);
    persistDraft(state);
    renderCurrentStep({ type: 'tag', value: tag });
  });
  wrapper.appendChild(select);
  return wrapper;
}

function createNotesSection(state) {
  const wrapper = document.createElement('div');
  wrapper.className = 'diary-notes-section';
  const label = document.createElement('label');
  label.htmlFor = 'diary-rating-notes';
  label.className = 'diary-field-label';
  setTranslatedText(label, 'rating.notes');
  const input = document.createElement('textarea');
  input.id = 'diary-rating-notes';
  input.className = 'diary-field';
  input.rows = 4;
  input.maxLength = 200;
  setTranslatedAttribute(input, 'rating.notesPlaceholder', 'placeholder');
  input.value = state.notes;
  input.addEventListener('input', () => {
    state.notes = input.value;
    persistDraft(state);
  });
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return wrapper;
}

function createSegmentOverrideSection(state) {
  const wrapper = createHeading('rating.segmentDetailsTitle', 'rating.segmentDetailsHint');
  const segments = selectLowestRatedSegments(state.route, state.segmentLookup);
  if (segments.length === 0) {
    const empty = document.createElement('p');
    setTranslatedText(empty, 'rating.noSegments');
    wrapper.appendChild(empty);
    return wrapper;
  }

  segments.forEach(({ segmentId, index, feature }) => {
    const row = document.createElement('div');
    row.className = 'diary-segment-row';
    row.title = segmentId;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.overrides.has(segmentId);
    checkbox.dataset.focusType = 'segment';
    checkbox.dataset.focusValue = segmentId;
    setTranslatedAttribute(checkbox, 'rating.override', 'aria-label', {
      segment: getSegmentDisplayLabel(feature, index + 1),
    });
    const label = document.createElement('strong');
    label.textContent = getSegmentDisplayLabel(feature, index + 1);
    const select = document.createElement('select');
    select.className = 'diary-field diary-segment-rating';
    setTranslatedAttribute(select, 'rating.segmentRating', 'aria-label', {
      segment: getSegmentDisplayLabel(feature, index + 1),
    });
    select.disabled = !checkbox.checked;
    for (let rating = 1; rating <= 5; rating += 1) {
      const option = document.createElement('option');
      option.value = String(rating);
      option.textContent = `${rating}★`;
      select.appendChild(option);
    }
    select.value = String(state.overrides.get(segmentId) || state.overallRating || 3);
    checkbox.addEventListener('change', () => {
      if (!checkbox.checked) {
        state.overrides.delete(segmentId);
        persistDraft(state);
        renderCurrentStep({ type: 'segment', value: segmentId });
        return;
      }
      const result = setSegmentOverride(state.overrides, segmentId, select.value);
      if (!result.ok) {
        checkbox.checked = false;
        setError(localizeRatingError(result.error));
        return;
      }
      persistDraft(state);
      renderCurrentStep({ type: 'segment', value: segmentId });
    });
    select.addEventListener('change', () => {
      const result = setSegmentOverride(state.overrides, segmentId, select.value);
      if (!result.ok) setError(localizeRatingError(result.error));
      else persistDraft(state);
    });
    row.appendChild(checkbox);
    row.appendChild(label);
    row.appendChild(select);
    wrapper.appendChild(row);
  });
  return wrapper;
}

function createFooter(state) {
  const footer = document.createElement('div');
  footer.className = 'diary-modal-footer';
  if (state.step !== 'overall') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'diary-button-secondary';
    back.disabled = state.pending;
    setTranslatedText(back, 'rating.back');
    back.addEventListener('click', () => changeStep(state.step === 'segments' ? 'details' : 'overall'));
    footer.appendChild(back);
  }
  if (state.step === 'overall') {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'diary-button-primary';
    next.disabled = state.pending || state.overallRating == null;
    setTranslatedText(next, 'rating.continue');
    next.addEventListener('click', () => {
      const result = validateRatingStep(state);
      if (!result.ok) setError(localizeRatingError(result.error));
      else changeStep('details');
    });
    footer.appendChild(next);
  } else {
    if (state.step === 'details') {
      const segments = document.createElement('button');
      segments.type = 'button';
      segments.className = 'diary-button-link';
      segments.disabled = state.pending;
      setTranslatedText(segments, 'rating.addSegments');
      segments.addEventListener('click', () => {
        const result = validateRatingStep(state);
        if (!result.ok) setError(localizeRatingError(result.error));
        else changeStep('segments');
      });
      footer.appendChild(segments);
    }
    submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'diary-button-primary';
    submitBtn.disabled = state.pending;
    setTranslatedText(submitBtn, state.pending ? 'rating.submitting' : 'rating.save');
    footer.appendChild(submitBtn);
  }
  return footer;
}

function changeStep(step) {
  if (!currentState) return;
  currentState.step = step;
  persistDraft(currentState);
  renderCurrentStep({ type: 'step', value: step });
}

function buildPayload(state) {
  const routeProps = state.route.properties || {};
  const payload = {
    route_id: routeProps.route_id,
    segment_ids: routeProps.segment_ids || [],
    overall_rating: state.overallRating,
    tags: Array.from(state.tags),
    segment_overrides: Array.from(state.overrides, ([segment_id, rating]) => ({ segment_id, rating })),
    mode: (routeProps.mode || 'walk').toLowerCase() === 'bike' ? 'bike' : 'walk',
    user_hash: state.userHash,
    timestamp: new Date().toISOString(),
  };
  const notes = state.notes.trim();
  if (notes) payload.notes = notes;
  return payload;
}

async function handleSubmit(event) {
  event.preventDefault();
  const state = currentState;
  if (!state || state.pending || state.signal?.aborted) return;
  const detailsValidation = validateRatingStep({ ...state, step: 'details' });
  if (!state.overallRating) {
    setError(t('rating.selectOverall'));
    return;
  }
  if (!detailsValidation.ok) {
    setError(localizeRatingError(detailsValidation.error));
    return;
  }
  const payload = buildPayload(state);
  if (!validatePayload(payload)) {
    setError(ajv.errorsText(validatePayload.errors, { separator: '\n' }));
    return;
  }

  setError('');
  try {
    console.info('[Diary] submit payload', payload);
    const result = await runRatingSubmission({
      state,
      payload,
      submit: submitDiary,
      isCurrent: () => currentState === state,
      onPendingChange: () => {
        if (currentState === state) renderCurrentStep();
      },
    });
    if (!result.applied) return;
    const { response } = result;
    console.info('[Diary] submit response', response);
    finalizeDiarySubmission({ state, payload, response, isCurrent: () => currentState === state });
  } catch (error) {
    if (currentState === state && !state.signal?.aborted && error?.name !== 'AbortError') {
      setError(error?.message || t('rating.submissionFailed'));
    }
  }
}

export async function runRatingSubmission({
  state,
  payload,
  submit = submitDiary,
  isCurrent = () => true,
  onPendingChange = () => {},
} = {}) {
  if (!state || state.signal?.aborted || !isCurrent()) return { applied: false, reason: 'stale' };
  if (state.pending) return { applied: false, reason: 'pending' };
  state.pending = true;
  onPendingChange(true);
  try {
    const response = await submit(payload, { signal: state.signal });
    if (state.signal?.aborted || !isCurrent()) return { applied: false, reason: 'stale' };
    return { applied: true, response };
  } finally {
    state.pending = false;
    onPendingChange(false);
  }
}

function setError(message) {
  if (errorEl) errorEl.textContent = message || '';
}
