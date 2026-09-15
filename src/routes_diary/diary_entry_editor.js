import { t } from '../i18n/index.js';
import '../i18n/diary_editor.js';
import '../styles/diary-editor.css';
import { diaryRouteDistance } from './diary_trip_geometry.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function localDateValue(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Resolves to the saved entry, or null on cancel/abort. Persistence belongs to onSave. */
export function openDiaryEntryEditor({ entry = null, routeFeature = null, onSave, onClose, signal } = {}) {
  if (signal?.aborted) return Promise.resolve(null);
  if (typeof onSave !== 'function') throw new TypeError('Diary editor requires onSave.');
  const previousFocus = document.activeElement;
  const dialog = element('dialog', 'diary-editor');
  const title = element('h2', '', t(entry ? 'diary.editor.edit' : 'diary.editor.new'));
  title.id = `diary-editor-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby', title.id);
  const form = element('form', 'diary-editor__form');
  form.append(title, element('p', 'diary-editor__hint', t('diary.editor.privacy')));
  dialog.append(form);

  const field = (key, input) => {
    const label = element('label', 'diary-editor__field');
    label.append(element('span', '', t(key)), input);
    form.append(label);
    return input;
  };
  const properties = routeFeature?.properties || {};
  let geometry = entry?.routeGeometry ?? routeFeature?.geometry ?? null;
  let source = entry?.routeSourceVersion || properties.source_version || 'user-provided';
  let routeId = entry?.routeId ?? properties.route_id ?? null;
  let segmentIds = [...(entry?.segmentIds || properties.segment_ids || [])];
  let segmentOverrides = { ...(entry?.segmentOverrides || {}) };
  const name = field('diary.editor.label', element('input'));
  name.name = 'label';
  name.required = true;
  name.maxLength = 500;
  name.value = entry?.label || properties.name || '';
  name.pattern = '.*\\S.*';
  const time = field('diary.editor.time', element('input'));
  time.type = 'datetime-local';
  time.name = 'occurredAt';
  time.required = true;
  time.value = localDateValue(entry?.occurredAt || entry?.createdAt || new Date());
  const mode = field('diary.editor.mode', element('select'));
  mode.name = 'mode';
  for (const value of ['walk', 'bike']) {
    const option = element('option', '', t(`diary.editor.${value}`));
    option.value = value;
    mode.append(option);
  }
  mode.value = entry?.mode || properties.mode || 'walk';
  if (!mode.value) mode.value = 'walk';
  const score = field('diary.editor.score', element('select'));
  score.name = 'score';
  score.required = true;
  const placeholder = element('option', '', t('diary.editor.choose'));
  placeholder.value = '';
  score.append(placeholder);
  for (let value = 1; value <= 5; value += 1) {
    const option = element('option', '', String(value));
    option.value = String(value);
    score.append(option);
  }
  score.value = entry?.score ? String(entry.score) : '';
  score.parentElement.append(element('span', 'diary-editor__hint', t('diary.editor.scoreHint')));
  const tags = element('fieldset', 'diary-editor__tags');
  tags.append(element('legend', '', t('diary.editor.tags')));
  const selectedTags = new Set(entry?.tags || []);
  const standardTags = ['comfortable', 'quiet', 'scenic', 'ordinary', 'crowded', 'noisy'];
  for (const value of new Set([...standardTags, ...selectedTags])) {
    const label = element('label', 'diary-editor__tag');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedTags.has(value);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedTags.add(value);
      else selectedTags.delete(value);
    });
    label.append(checkbox, document.createTextNode(standardTags.includes(value) ? t(`diary.editor.${value}`) : value));
    tags.append(label);
  }
  form.append(tags);
  const notes = field('diary.editor.notes', element('textarea'));
  notes.name = 'notes';
  notes.maxLength = 20_000;
  notes.value = entry?.notes || '';
  const route = element('section', 'diary-editor__route');
  route.append(element('strong', '', t('diary.editor.route')));
  const routeStatus = element('p', 'diary-editor__hint');
  const updateRouteStatus = () => {
    routeStatus.textContent = t(geometry ? 'diary.editor.attached' : 'diary.editor.noRoute', { source });
    const distance = diaryRouteDistance(geometry);
    if (distance != null) routeStatus.textContent += ` · ${t('diary.editor.distance', { km: (distance / 1000).toFixed(2) })}`;
  };
  updateRouteStatus();
  route.append(routeStatus);
  form.append(route);
  const file = field('diary.editor.import', element('input'));
  file.type = 'file';
  file.accept = '.geojson,.json,application/geo+json,application/json';
  file.parentElement.append(element('span', 'diary-editor__hint', t('diary.editor.importHint')));
  const error = element('p', 'diary-editor__error');
  error.setAttribute('role', 'alert');
  error.tabIndex = -1;
  error.hidden = true;
  const actions = element('div', 'diary-editor__actions');
  const cancel = element('button', '', t('diary.editor.cancel'));
  cancel.type = 'button';
  const save = element('button', '', t('diary.editor.save'));
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(error, actions);
  let closed = false;
  let busy = false;
  let finish;
  const result = new Promise((resolve) => { finish = resolve; });
  const close = (value = null) => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', abort);
    dialog.close();
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    finish(value);
    onClose?.(value);
  };
  const abort = () => close();
  result.close = () => close();
  const setBusy = (value, key = 'diary.editor.saving') => {
    busy = value;
    form.setAttribute('aria-busy', String(value));
    for (const control of form.querySelectorAll('input, select, textarea, button')) control.disabled = value;
    save.textContent = t(value ? key : 'diary.editor.save');
  };
  const showError = (key) => {
    error.textContent = t(key);
    error.hidden = false;
    error.focus();
  };
  cancel.addEventListener('click', () => close());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!busy) close();
  });
  signal?.addEventListener('abort', abort, { once: true });
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (!chosen || busy || closed) return;
    error.hidden = true;
    setBusy(true, 'diary.editor.importing');
    try {
      const { readRouteGeoJsonFile } = await import('../routes_crime/route_input.js');
      if (closed || signal?.aborted) return;
      const imported = await readRouteGeoJsonFile(chosen);
      if (closed || signal?.aborted) return;
      geometry = imported.geometry;
      source = 'user-provided';
      routeId = null;
      segmentIds = [];
      segmentOverrides = {};
      updateRouteStatus();
    } catch {
      if (!closed) showError('diary.editor.importError');
    } finally {
      if (!closed) { setBusy(false); file.value = ''; }
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (closed || busy || signal?.aborted || !form.reportValidity()) return;
    const occurredAt = new Date(time.value);
    if (!Number.isFinite(occurredAt.getTime())) {
      showError('diary.editor.invalidTime');
      return;
    }
    const now = new Date().toISOString();
    const value = {
      ...entry,
      id: entry?.id || crypto.randomUUID(),
      createdAt: entry?.createdAt || now,
      updatedAt: now,
      occurredAt: occurredAt.toISOString(),
      label: name.value.trim(),
      mode: mode.value,
      score: Number(score.value),
      tags: [...selectedTags],
      notes: notes.value,
      routeId,
      routeGeometry: geometry,
      routeSourceVersion: source,
      segmentIds,
      segmentOverrides,
    };
    error.hidden = true;
    setBusy(true);
    try {
      const saved = await onSave(value);
      if (closed || signal?.aborted) return;
      if (saved === false || saved?.ok === false || saved?.applied === false) throw new Error('Save rejected');
      close(value);
    } catch {
      if (!closed) { setBusy(false); showError('diary.editor.saveError'); }
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
  return result;
}
