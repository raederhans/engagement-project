const REQUIRED_COPY = [
  'heading', 'description', 'fileLabel', 'preview', 'apply', 'noFile',
  'ready', 'notRecoverable', 'applied', 'failed', 'schemaLabel',
  'queryLabel', 'geographyLabel', 'timeRangeLabel', 'resultStatusLabel',
  'sourceStatusLabel', 'sourceReasonLabel', 'sourceCoverageLabel', 'limitationsLabel',
  'recoveryLabel', 'recoveryReasonLabel', 'unknownValue',
];
let nextViewId = 0;

function requireCopy(copy) {
  for (const key of REQUIRED_COPY) {
    if (typeof copy?.[key] !== 'string' || !copy[key].trim()) {
      throw new TypeError(`Evidence Bundle import preview requires copy.${key}.`);
    }
  }
  return copy;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const COPY_KEYS = Object.freeze({
  heading: 'history.import.heading',
  description: 'history.import.description',
  fileLabel: 'history.import.fileLabel',
  preview: 'history.import.preview',
  apply: 'history.import.apply',
  noFile: 'history.import.noFile',
  ready: 'history.import.ready',
  notRecoverable: 'history.import.notRecoverable',
  applied: 'history.import.applied',
  failed: 'history.import.failed',
  schemaLabel: 'history.import.schemaLabel',
  queryLabel: 'history.import.queryLabel',
  geographyLabel: 'history.import.geographyLabel',
  timeRangeLabel: 'history.import.timeRangeLabel',
  resultStatusLabel: 'history.import.resultStatusLabel',
  sourceStatusLabel: 'history.import.sourceStatusLabel',
  sourceReasonLabel: 'history.import.sourceReasonLabel',
  sourceCoverageLabel: 'history.import.sourceCoverageLabel',
  limitationsLabel: 'history.import.limitationsLabel',
  recoveryLabel: 'history.import.recoveryLabel',
  recoveryReasonLabel: 'history.import.recoveryReasonLabel',
  unknownValue: 'history.import.unknownValue',
});

export function createEvidenceBundleImportCopy(translate) {
  if (typeof translate !== 'function') throw new TypeError('Evidence Bundle import copy requires a translator.');
  return Object.fromEntries(Object.entries(COPY_KEYS).map(([key, messageKey]) => [key, translate(messageKey)]));
}

function geographyText(summary, unknownValue) {
  const geography = summary.geography || {};
  if (geography.mode === 'district') return `district · ${geography.districtCode || unknownValue}`;
  if (geography.mode === 'tract') return `tract · ${geography.tractGEOID || unknownValue}`;
  if (geography.mode === 'buffer') return `buffer · ${geography.radiusM || unknownValue} m · exact selection omitted`;
  return summary.geographyMode || unknownValue;
}

function coverageText(summary, unknownValue) {
  const rows = summary.sourceCoverage || [];
  if (!rows.length) return unknownValue;
  return rows.map(({ sourceId, start, end }) => (
    `${sourceId}: ${start || unknownValue} – ${end || unknownValue}`
  )).join('; ');
}

function sourceReasonText(summary, unknownValue) {
  const rows = summary.sourceStatusReasons || [];
  if (!rows.length) return unknownValue;
  return rows.map(({ sourceId, reason }) => `${sourceId}: ${reason || unknownValue}`).join('; ');
}

export function createEvidenceBundleImportPreviewView(mount, {
  copy: rawCopy,
  onPreview,
  onApply,
} = {}) {
  if (!mount || typeof onPreview !== 'function' || typeof onApply !== 'function') {
    throw new TypeError('Evidence Bundle import preview requires mount, onPreview, and onApply.');
  }
  let copy = requireCopy(rawCopy);
  const headingId = `evidence-bundle-import-${++nextViewId}`;
  const inputId = `${headingId}-file`;
  const section = element('section', '', 'evidence-bundle-import');
  section.setAttribute('aria-labelledby', headingId);
  const heading = element('h3', copy.heading);
  heading.id = headingId;
  const description = element('p', copy.description);
  const label = element('label');
  label.setAttribute('for', inputId);
  const labelText = element('span', copy.fileLabel);
  const input = element('input');
  input.id = inputId;
  input.type = 'file';
  input.accept = 'application/json,.json';
  const previewButton = element('button', copy.preview);
  previewButton.type = 'button';
  const applyButton = element('button', copy.apply);
  applyButton.type = 'button';
  applyButton.disabled = true;
  const summary = element('dl', '', 'evidence-bundle-import__summary');
  const status = element('div', '', 'evidence-bundle-import__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  label.append(labelText, input);
  section.append(heading, description, label, previewButton, summary, status, applyButton);
  mount.replaceChildren(section);
  let currentPreview = null;
  let pending = false;

  function invalidatePreview({ clearFile = false, focus = false } = {}) {
    currentPreview = null;
    if (clearFile) input.value = '';
    summary.replaceChildren();
    status.textContent = '';
    delete status.dataset.tone;
    applyButton.disabled = true;
    if (focus) input.focus();
  }

  function setPending(value) {
    pending = value;
    section.setAttribute('aria-busy', String(value));
    input.disabled = value;
    previewButton.disabled = value;
    applyButton.disabled = value || currentPreview?.recovery?.status !== 'ready';
  }

  function showPreview(preview, { focusApply = true } = {}) {
    currentPreview = preview;
    const rows = [
      [copy.schemaLabel, preview.schemaVersion],
      [copy.queryLabel, preview.summary.queryType],
      [copy.geographyLabel, geographyText(preview.summary, copy.unknownValue)],
      [copy.timeRangeLabel, `${preview.summary.timeRange.start} – ${preview.summary.timeRange.endExclusive}`],
      [copy.resultStatusLabel, preview.summary.resultStatus],
      [copy.sourceStatusLabel, preview.summary.sourceStatuses?.join(', ') || copy.unknownValue],
      [copy.sourceReasonLabel, sourceReasonText(preview.summary, copy.unknownValue)],
      [copy.sourceCoverageLabel, coverageText(preview.summary, copy.unknownValue)],
      [copy.limitationsLabel, preview.summary.limitations?.join(' · ') || copy.unknownValue],
      [copy.recoveryLabel, preview.recovery.status],
      [copy.recoveryReasonLabel, preview.recovery.reason || copy.unknownValue],
    ];
    summary.replaceChildren(...rows.flatMap(([term, value]) => [
      element('dt', term),
      element('dd', value),
    ]));
    status.textContent = preview.recovery.status === 'ready'
      ? copy.ready
      : `${copy.notRecoverable}: ${preview.recovery.reason || copy.unknownValue}`;
    status.dataset.tone = preview.recovery.status === 'ready' ? 'success' : 'warning';
    applyButton.disabled = preview.recovery.status !== 'ready';
    if (!applyButton.disabled && focusApply) applyButton.focus();
  }

  input.addEventListener('change', () => invalidatePreview());
  previewButton.addEventListener('click', () => {
    if (pending) return;
    const file = input.files?.[0];
    if (!file) {
      status.textContent = copy.noFile;
      status.dataset.tone = 'warning';
      input.focus();
      return;
    }
    invalidatePreview();
    setPending(true);
    void Promise.resolve()
      .then(() => file.text())
      .then(onPreview)
      .then(showPreview)
      .catch((error) => {
        status.textContent = `${copy.failed}: ${error?.message || error}`;
        status.dataset.tone = 'warning';
        previewButton.focus();
      })
      .finally(() => setPending(false));
  });
  applyButton.addEventListener('click', () => {
    if (pending || !currentPreview || currentPreview.recovery.status !== 'ready') return;
    const preview = currentPreview;
    setPending(true);
    void Promise.resolve(onApply(preview))
      .then(() => {
        currentPreview = null;
        applyButton.disabled = true;
        status.textContent = copy.applied;
        status.dataset.tone = 'success';
      })
      .catch((error) => {
        status.textContent = `${copy.failed}: ${error?.message || error}`;
        status.dataset.tone = 'warning';
        applyButton.focus();
      })
      .finally(() => setPending(false));
  });

  return Object.freeze({
    setPreview: showPreview,
    setCopy(nextCopy) {
      copy = requireCopy(nextCopy);
      heading.textContent = copy.heading;
      description.textContent = copy.description;
      labelText.textContent = copy.fileLabel;
      previewButton.textContent = copy.preview;
      applyButton.textContent = copy.apply;
      if (currentPreview) showPreview(currentPreview, { focusApply: false });
    },
    clear() {
      invalidatePreview({ clearFile: true, focus: true });
    },
  });
}
