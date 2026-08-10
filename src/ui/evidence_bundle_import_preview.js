const REQUIRED_COPY = [
  'heading', 'description', 'fileLabel', 'preview', 'apply', 'noFile',
  'ready', 'notRecoverable', 'applied', 'failed', 'schemaLabel',
  'geographyLabel', 'resultStatusLabel', 'sourceCountLabel', 'recoveryLabel',
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

export function createEvidenceBundleImportPreviewView(mount, {
  copy: rawCopy,
  onPreview,
  onApply,
} = {}) {
  if (!mount || typeof onPreview !== 'function' || typeof onApply !== 'function') {
    throw new TypeError('Evidence Bundle import preview requires mount, onPreview, and onApply.');
  }
  const copy = requireCopy(rawCopy);
  const headingId = `evidence-bundle-import-${++nextViewId}`;
  const inputId = `${headingId}-file`;
  const section = element('section', '', 'evidence-bundle-import');
  section.setAttribute('aria-labelledby', headingId);
  const heading = element('h3', copy.heading);
  heading.id = headingId;
  const description = element('p', copy.description);
  const label = element('label', copy.fileLabel);
  label.setAttribute('for', inputId);
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
  label.append(input);
  section.append(heading, description, label, previewButton, summary, status, applyButton);
  mount.replaceChildren(section);
  let currentPreview = null;
  let pending = false;

  function setPending(value) {
    pending = value;
    input.disabled = value;
    previewButton.disabled = value;
    applyButton.disabled = value || currentPreview?.recovery?.status !== 'ready';
  }

  function showPreview(preview) {
    currentPreview = preview;
    const rows = [
      [copy.schemaLabel, preview.schemaVersion],
      [copy.geographyLabel, preview.summary.geographyMode],
      [copy.resultStatusLabel, preview.summary.resultStatus],
      [copy.sourceCountLabel, String(preview.summary.sourceCount)],
      [copy.recoveryLabel, preview.recovery.status],
    ];
    summary.replaceChildren(...rows.flatMap(([term, value]) => [
      element('dt', term),
      element('dd', value),
    ]));
    status.textContent = preview.recovery.status === 'ready' ? copy.ready : copy.notRecoverable;
    applyButton.disabled = preview.recovery.status !== 'ready';
    if (!applyButton.disabled) applyButton.focus();
  }

  async function report(action, successCopy) {
    if (pending) return;
    setPending(true);
    try {
      const result = await action();
      status.textContent = successCopy;
      return result;
    } catch (error) {
      status.textContent = `${copy.failed}: ${error?.message || error}`;
      return null;
    } finally {
      setPending(false);
    }
  }

  previewButton.addEventListener('click', () => {
    const file = input.files?.[0];
    if (!file) {
      status.textContent = copy.noFile;
      input.focus();
      return;
    }
    void report(async () => {
      const preview = await onPreview(await file.text());
      showPreview(preview);
      return preview;
    }, copy.ready);
  });
  applyButton.addEventListener('click', () => {
    if (!currentPreview || currentPreview.recovery.status !== 'ready') return;
    void report(() => onApply(currentPreview), copy.applied);
  });

  return Object.freeze({
    setPreview: showPreview,
    clear() {
      currentPreview = null;
      input.value = '';
      summary.replaceChildren();
      status.textContent = '';
      applyButton.disabled = true;
      input.focus();
    },
  });
}
