import Ajv from 'ajv';
import { submitDiary } from '../api/diary.js';
import { SCORE_PROP } from './data_normalization.js';
import { getSegmentDisplayLabel } from './labels.js';

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
const TAG_OPTIONS = ALL_TAGS;

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
      items: { type: 'string', enum: TAG_OPTIONS },
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

let modalStylesInjected = false;
let activeBackdrop = null;
let activeModal = null;
let errorEl = null;
let submitBtn = null;
let escapeHandler = null;
let currentState = null;

export function submitSegmentFeedback(payload) {
  console.info('[Diary] Segment feedback submitted', payload);
  return payload;
}

function injectModalStyles() {
  if (modalStylesInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = `
    .diary-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2500;
    }
    .diary-modal-card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
      border: 1px solid #e2e8f0;
      width: min(540px, 92vw);
      max-height: 85vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 24px;
      font: 14px/1.45 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #0f172a;
      position: relative;
      z-index: 2501;
    }
    .diary-modal-card .diary-modal-body {
      overflow-y: auto;
      padding-right: 2px;
      max-height: calc(85vh - 140px);
    }
    .diary-modal-close {
      border: none;
      background: transparent;
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
      color: #475569;
    }
  `;
  document.head.appendChild(style);
  modalStylesInjected = true;
}

export function openRatingModal({ routeFeature, segmentLookup, userHash, onSuccess }) {
  if (!routeFeature) return;
  closeRatingModal();
  if (typeof document === 'undefined') return;

  currentState = {
    route: routeFeature,
    segmentLookup: segmentLookup || new Map(),
    userHash,
    tags: new Set(),
    overrides: new Map(),
    overallRating: 3,
    noteInput: null,
    onSuccess,
  };

  injectModalStyles();

  const backdrop = document.createElement('div');
  backdrop.className = 'diary-modal-backdrop';
  backdrop.addEventListener('click', closeRatingModal);

  const modal = document.createElement('div');
  modal.className = 'diary-modal-card';
  modal.addEventListener('click', (e) => e.stopPropagation());

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.style.fontSize = '18px';
  title.textContent = 'Rate this route';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.className = 'diary-modal-close';
  closeBtn.addEventListener('click', closeRatingModal);
  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const subtitle = document.createElement('p');
  subtitle.style.margin = '8px 0 16px';
  subtitle.style.fontSize = '13px';
  subtitle.style.color = '#475569';
  subtitle.textContent = `${routeFeature.properties?.from || 'Origin'} → ${routeFeature.properties?.to || 'Destination'}`;
  modal.appendChild(subtitle);

  const form = document.createElement('form');
  form.style.display = 'flex';
  form.style.flexDirection = 'column';
  form.style.gap = '16px';
  form.className = 'diary-modal-body';
  form.style.maxHeight = 'calc(82vh - 140px)';
  form.style.paddingRight = '2px';

  form.appendChild(createStarSelector(currentState));
  form.appendChild(createTagSelector(currentState));
  form.appendChild(createSegmentOverrideSection(currentState));
  form.appendChild(createNotesSection(currentState));

  errorEl = document.createElement('div');
  errorEl.style.color = '#b91c1c';
  errorEl.style.fontSize = '13px';
  errorEl.style.minHeight = '18px';
  form.appendChild(errorEl);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '12px';
  actions.style.marginTop = '8px';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.style.flex = '1';
  cancel.style.padding = '10px 12px';
  cancel.style.border = '1px solid #e2e8f0';
  cancel.style.borderRadius = '10px';
  cancel.style.background = '#fff';
  cancel.style.cursor = 'pointer';
  cancel.style.fontWeight = '600';
  cancel.addEventListener('click', closeRatingModal);

  submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = 'Submit rating';
  submitBtn.style.flex = '1';
  submitBtn.style.padding = '10px 12px';
  submitBtn.style.border = 'none';
  submitBtn.style.borderRadius = '10px';
  submitBtn.style.background = '#10b981';
  submitBtn.style.color = '#fff';
  submitBtn.style.fontWeight = '600';
  submitBtn.style.cursor = 'pointer';

  actions.appendChild(cancel);
  actions.appendChild(submitBtn);
  form.appendChild(actions);

  form.addEventListener('submit', handleSubmit);

  modal.appendChild(form);

  activeBackdrop = backdrop;
  activeModal = modal;
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  escapeHandler = (e) => {
    if (e.key === 'Escape') {
      closeRatingModal();
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

export function closeRatingModal() {
  if (activeBackdrop) {
    activeBackdrop.remove();
    activeBackdrop = null;
  }
  if (activeModal) {
    activeModal.remove();
    activeModal = null;
  }
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
  }
  currentState = null;
  errorEl = null;
  submitBtn = null;
}

function createStarSelector(state) {
  const wrapper = document.createElement('div');
  const label = document.createElement('div');
  label.textContent = 'Overall safety';
  label.style.fontWeight = '600';
  wrapper.appendChild(label);

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '6px';
  row.style.marginTop = '6px';
  row.style.alignItems = 'center';

  const stars = [];
  for (let i = 1; i <= 5; i += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '★';
    btn.style.fontSize = '24px';
    btn.style.lineHeight = '24px';
    btn.style.border = 'none';
    btn.style.background = 'transparent';
    btn.style.cursor = 'pointer';
    btn.style.color = i <= state.overallRating ? '#fbbf24' : '#e2e8f0';
    btn.addEventListener('click', () => {
      state.overallRating = i;
      stars.forEach((starBtn, idx) => {
        starBtn.style.color = idx < i ? '#fbbf24' : '#cbd5f5';
      });
    });
    stars.push(btn);
    row.appendChild(btn);
  }
  wrapper.appendChild(row);
  return wrapper;
}

function createTagSelector(state) {
  const wrapper = document.createElement('div');
  const label = document.createElement('div');
  label.textContent = 'Top tags (pick up to 3)';
  label.style.fontWeight = '600';
  wrapper.appendChild(label);

  const chips = document.createElement('div');
  chips.style.display = 'flex';
  chips.style.flexWrap = 'wrap';
  chips.style.gap = '8px';
  chips.style.marginTop = '8px';
  chips.style.maxHeight = '120px';
  chips.style.overflowY = 'auto';

  function renderChips() {
    chips.innerHTML = '';
    const picked = state.tags;
    DEFAULT_TAG_CHIPS.forEach((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = tag.replace(/_/g, ' ');
      chip.style.border = '1px solid #e2e8f0';
      chip.style.borderRadius = '999px';
      chip.style.padding = '6px 12px';
      chip.style.fontSize = '12px';
      chip.style.cursor = 'pointer';
      chip.style.background = '#fff';
      const updateStyle = () => {
        const active = picked.has(tag);
        chip.style.background = active ? '#10b981' : '#fff';
        chip.style.color = active ? '#fff' : '#0f172a';
        chip.style.borderColor = active ? '#10b981' : '#e2e8f0';
      };
      chip.addEventListener('click', () => {
        if (picked.has(tag)) {
          picked.delete(tag);
        } else {
          if (picked.size >= 3) {
            setError('Select at most three tags.');
            return;
          }
          picked.add(tag);
        }
        setError('');
        updateStyle();
        refreshSelect();
      });
      updateStyle();
      chips.appendChild(chip);
    });

    // render any extra selected tags not in default chips
    Array.from(picked).forEach((tag) => {
      if (DEFAULT_TAG_CHIPS.includes(tag)) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = tag.replace(/_/g, ' ');
      chip.style.border = '1px solid #10b981';
      chip.style.borderRadius = '999px';
      chip.style.padding = '6px 12px';
      chip.style.fontSize = '12px';
      chip.style.cursor = 'pointer';
      chip.style.background = '#10b981';
      chip.style.color = '#fff';
      chip.addEventListener('click', () => {
        picked.delete(tag);
        refreshSelect();
        renderChips();
      });
      chips.appendChild(chip);
    });
  }

  const selectWrap = document.createElement('div');
  selectWrap.style.display = 'flex';
  selectWrap.style.alignItems = 'center';
  selectWrap.style.gap = '8px';
  selectWrap.style.marginTop = '8px';
  const selectLabel = document.createElement('div');
  selectLabel.textContent = 'More tags';
  selectLabel.style.fontSize = '12px';
  selectLabel.style.color = '#475569';
  const select = document.createElement('select');
  select.style.flex = '1';
  select.style.padding = '8px 10px';
  select.style.border = '1px solid #e2e8f0';
  select.style.borderRadius = '10px';
  select.style.fontSize = '12px';

  function refreshSelect() {
    const picked = state.tags;
    const unused = ALL_TAGS.filter((tag) => !picked.has(tag));
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = unused.length ? 'Add a tag…' : 'All tags selected';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    unused.forEach((tag) => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag.replace(/_/g, ' ');
      select.appendChild(opt);
    });
    select.disabled = unused.length === 0 || picked.size >= 3;
  }

  select.addEventListener('change', () => {
    const value = select.value;
    if (!value) return;
    if (state.tags.size >= 3) {
      setError('Select at most three tags.');
      select.value = '';
      return;
    }
    state.tags.add(value);
    setError('');
    select.value = '';
    refreshSelect();
    renderChips();
  });

  wrapper.appendChild(chips);
  selectWrap.appendChild(selectLabel);
  selectWrap.appendChild(select);
  wrapper.appendChild(selectWrap);
  refreshSelect();
  renderChips();
  return wrapper;
}

function createSegmentOverrideSection(state) {
  const wrapper = document.createElement('div');
  const label = document.createElement('div');
  label.textContent = 'Segment overrides (optional, max 2)';
  label.style.fontWeight = '600';
  wrapper.appendChild(label);

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';
  list.style.marginTop = '8px';

  const segmentIds = state.route.properties?.segment_ids || [];
  if (segmentIds.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No segments available for overrides.';
    empty.style.fontSize = '12px';
    empty.style.color = '#64748b';
    list.appendChild(empty);
  }

  // Gather segment data with safety scores for sorting
  const segmentsData = segmentIds.map((segmentId, idx) => {
    const segmentFeature = state.segmentLookup?.get?.(segmentId) || state.segmentLookup?.[segmentId];
    const safetyScore = Number(segmentFeature?.properties?.[SCORE_PROP]) || 3;
    const label = getSegmentDisplayLabel(segmentFeature, idx + 1);
    return { segmentId, idx, safetyScore, label };
  });

  // Sort by safety score (lowest first = most concerning segments)
  const sortedSegments = segmentsData.slice().sort((a, b) => a.safetyScore - b.safetyScore);

  // Show top 3 worst segments by default, rest in collapsible
  const topSegments = sortedSegments.slice(0, 3);
  const restSegments = sortedSegments.slice(3);

  const createSegmentRow = ({ segmentId, idx, label }) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.border = '1px solid #e2e8f0';
    row.style.borderRadius = '10px';
    row.style.padding = '8px 10px';
    row.title = segmentId;

    const labelWrap = document.createElement('div');
    labelWrap.style.display = 'flex';
    labelWrap.style.flexDirection = 'column';
    labelWrap.style.fontSize = '12px';
    labelWrap.style.color = '#475569';
    const friendly = label || `Segment ${idx + 1}`;
    labelWrap.innerHTML = `<strong style="color:#0f172a;">${friendly}</strong>`;

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '6px';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.cursor = 'pointer';
    const select = document.createElement('select');
    for (let rating = 1; rating <= 5; rating += 1) {
      const option = document.createElement('option');
      option.value = rating;
      option.textContent = `${rating}★`;
      select.appendChild(option);
    }
    select.disabled = true;
    select.style.borderRadius = '8px';
    select.style.border = '1px solid #e2e8f0';
    select.style.padding = '6px';
    select.addEventListener('change', () => {
      if (state.overrides.has(segmentId)) {
        state.overrides.set(segmentId, Number(select.value));
      }
    });

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        if (state.overrides.size >= 2) {
          checkbox.checked = false;
          setError('Only two segment overrides are supported.');
          return;
        }
        select.disabled = false;
        state.overrides.set(segmentId, Number(select.value));
      } else {
        select.disabled = true;
        state.overrides.delete(segmentId);
      }
      setError('');
    });

    controls.appendChild(checkbox);
    controls.appendChild(select);
    row.appendChild(labelWrap);
    row.appendChild(controls);
    return row;
  };

  // Add top segments (worst safety scores)
  if (topSegments.length > 0) {
    const topHint = document.createElement('div');
    topHint.textContent = 'Lowest-rated segments (select up to 2):';
    topHint.style.fontSize = '12px';
    topHint.style.color = '#64748b';
    topHint.style.marginBottom = '6px';
    list.appendChild(topHint);

    topSegments.forEach(seg => {
      list.appendChild(createSegmentRow(seg));
    });
  }

  // Add collapsible section for rest
  if (restSegments.length > 0) {
    const details = document.createElement('details');
    details.style.marginTop = '8px';
    const summary = document.createElement('summary');
    summary.textContent = `Show ${restSegments.length} more segment${restSegments.length > 1 ? 's' : ''}`;
    summary.style.fontSize = '12px';
    summary.style.color = '#475569';
    summary.style.cursor = 'pointer';
    summary.style.padding = '6px 0';
    details.appendChild(summary);

    const moreList = document.createElement('div');
    moreList.style.display = 'flex';
    moreList.style.flexDirection = 'column';
    moreList.style.gap = '8px';
    moreList.style.marginTop = '8px';

    restSegments.forEach(seg => {
      moreList.appendChild(createSegmentRow(seg));
    });

    details.appendChild(moreList);
    list.appendChild(details);
  }

  wrapper.appendChild(list);
  return wrapper;
}

function createNotesSection(state) {
  const wrapper = document.createElement('div');
  const label = document.createElement('div');
  label.textContent = 'Optional notes';
  label.style.fontWeight = '600';
  wrapper.appendChild(label);
  const input = document.createElement('textarea');
  input.rows = 3;
  input.maxLength = 200;
  input.placeholder = 'Add a short note (200 characters max).';
  input.style.width = '100%';
  input.style.borderRadius = '10px';
  input.style.border = '1px solid #e2e8f0';
  input.style.padding = '10px';
  input.style.font = '13px/1.4 "Inter", system-ui, sans-serif';
  state.noteInput = input;
  wrapper.appendChild(input);
  return wrapper;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!currentState) return;
  if (!currentState.overallRating) {
    setError('Select an overall rating.');
    return;
  }
  if (currentState.tags.size === 0) {
    setError('Pick at least one tag.');
    return;
  }
  const routeProps = currentState.route.properties || {};
  const overrides = Array.from(currentState.overrides.entries()).map(([segment_id, rating]) => ({ segment_id, rating }));
  const payload = {
    route_id: routeProps.route_id,
    segment_ids: routeProps.segment_ids || [],
    overall_rating: currentState.overallRating,
    tags: Array.from(currentState.tags),
    segment_overrides: overrides,
    mode: (routeProps.mode || 'walk').toLowerCase() === 'bike' ? 'bike' : 'walk',
    user_hash: currentState.userHash,
    timestamp: new Date().toISOString(),
  };
  const notesValue = currentState.noteInput?.value?.trim();
  if (notesValue) {
    payload.notes = notesValue;
  }

  if (!validatePayload(payload)) {
    const message = ajv.errorsText(validatePayload.errors, { separator: '\n' });
    setError(message);
    return;
  }

  setError('');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
  }

  try {
    console.info('[Diary] submit payload', payload);
    const response = await submitDiary(payload);
    console.info('[Diary] stub response', response);
    closeRatingModal();
    currentState?.onSuccess?.({ payload, response });
  } catch (err) {
    setError(err?.message || 'Submission failed.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit rating';
    }
  }
}

function setError(message) {
  if (!errorEl) return;
  errorEl.textContent = message || '';
}
