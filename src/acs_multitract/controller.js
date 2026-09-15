import './styles.css';

import {
  acsAggregationTableHtml,
  fetchAcsPopulationVreSnapshot,
  toAcsAggregationEvidenceRecord,
} from '../acs_aggregation.js';
import { getLanguage, onLanguageChange } from '../i18n/index.js';
import { createAcsMultitractWorkflow } from './workflow.js';
import { parseAcsTractSelectionText } from './selection.js';

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

export async function createAcsMultitractController({
  dialog,
  loadSnapshot,
  onSourceHealthObservation = () => {},
  onEvidenceRecord = () => {},
} = {}) {
  if (!dialog?.querySelector) throw new TypeError('ACS multi-tract dialog is required');
  const host = dialog.querySelector('[data-acs-multitract-host]');
  if (!host) throw new TypeError('ACS multi-tract host is required');
  const {
    acsMultitractProductHtml,
    acsMultitractReason,
    acsSelectionReviewHtml,
    getAcsMultitractCopy,
  } = await import('./view.js');

  let returnFocus = null;
  let generation = 0;
  let selectionText = '';
  let busy = false;
  let catalog = null;
  let catalogLoading = false;
  let catalogFailed = false;
  let destroyed = false;
  const workflow = createAcsMultitractWorkflow({
    loadSnapshot,
    onSourceHealthObservation,
    onEvidenceRecord,
  });

  function currentLocale() {
    return getLanguage();
  }

  function render() {
    const locale = currentLocale();
    const copy = getAcsMultitractCopy(locale);
    const manualOpen = host.querySelector('[data-acs-manual]')?.open || false;
    host.innerHTML = acsMultitractProductHtml(locale);
    const manual = host.querySelector('[data-acs-manual]');
    if (manual) manual.open = manualOpen;
    const input = host.querySelector('[data-acs-multitract-input]');
    const reviewButton = host.querySelector('[data-acs-multitract-review]');
    const calculateButton = host.querySelector('[data-acs-multitract-calculate]');
    const status = host.querySelector('[data-acs-multitract-status]');
    const reviewHost = host.querySelector('[data-acs-multitract-review-host]');
    const resultHost = host.querySelector('[data-acs-multitract-result]');
    const quick = host.querySelector('[data-acs-quick]');
    if (quick) {
      quick.disabled = busy || parseAcsTractSelectionText(selectionText).status !== 'available';
      quick.addEventListener('click', async () => {
        const result = await review();
        if (result.status === 'available' && !destroyed) calculate();
      });
    }
    const browse = host.querySelector('[data-acs-browse]');
    const choice = host.querySelector('[data-acs-choice]');
    if (browse && choice) {
      browse.hidden = Boolean(catalog);
      browse.disabled = catalogLoading;
      host.querySelector('[data-acs-picker]').hidden = !catalog;
      const catalogStatus = host.querySelector('[data-acs-catalog-status]');
      catalogStatus.hidden = !catalogLoading && !catalogFailed;
      catalogStatus.textContent = catalogLoading ? copy.catalogLoading : copy.catalogFailed;
      for (const row of catalog || []) {
        const option = dialog.ownerDocument.createElement('option');
        option.value = row.geoid;
        option.textContent = `${row.geoid} · ${Number(row.estimate).toLocaleString(locale)}`;
        choice.append(option);
      }
      host.querySelector('[data-acs-search]').addEventListener('input', (event) => {
        const term = event.target.value.trim();
        for (const option of choice.options) option.hidden = !option.value.includes(term);
        const match = [...choice.options].find((option) => !option.hidden);
        choice.value = match?.value || '';
        host.querySelector('[data-acs-add]').disabled = !match;
      });
      browse.addEventListener('click', () => { void browseTracts(); });
      host.querySelector('[data-acs-add]').addEventListener('click', () => {
        const values = new Set(selectionText.split(/[\s,;]+/).filter(Boolean));
        if (choice.value) values.add(choice.value);
        input.value = [...values].join('\n');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      });
    }
    const { reviewed, outcome } = workflow.getState();
    const exportButton = host.querySelector('[data-acs-export]');
    if (exportButton) {
      exportButton.hidden = outcome?.status !== 'available';
      exportButton.addEventListener('click', async () => {
        const record = toAcsAggregationEvidenceRecord(workflow.getState().outcome);
        if (!record) return;
        try {
          const { downloadTextFile } = await import('../utils/export_analysis.js');
          downloadTextFile('tract-population-analysis.json', JSON.stringify(record, null, 2), 'application/json');
        } catch {
          status.textContent = copy.exportFailed;
        }
      });
    }

    input.value = selectionText;
    reviewButton.disabled = busy;
    calculateButton.disabled = busy || reviewed?.status !== 'available';
    dialog.setAttribute('aria-busy', String(busy));
    if (busy) status.textContent = copy.loading;
    else if (reviewed?.status === 'available') status.textContent = copy.ready;
    else if (reviewed) status.textContent = acsMultitractReason(reviewed.reason, locale);
    else status.textContent = copy.idle;
    if (reviewed?.status === 'available') reviewHost.innerHTML = acsSelectionReviewHtml(reviewed, { locale });
    if (outcome) resultHost.innerHTML = acsAggregationTableHtml(outcome, { locale });

    input.addEventListener('input', () => {
      generation += 1;
      selectionText = input.value;
      workflow.invalidate();
      busy = false;
      reviewButton.disabled = false;
      calculateButton.disabled = true;
      dialog.setAttribute('aria-busy', 'false');
      status.textContent = copy.idle;
      reviewHost.replaceChildren();
      resultHost.replaceChildren();
      if (exportButton) exportButton.hidden = true;
      if (quick) quick.disabled = parseAcsTractSelectionText(selectionText).status !== 'available';
    });
    reviewButton.addEventListener('click', () => { void review(); });
    calculateButton.addEventListener('click', calculate);
    const closeButtons = [...host.querySelectorAll('[data-acs-multitract-close]')];
    if (!closeButtons.length && host.querySelector('[data-acs-multitract-close]')) {
      closeButtons.push(host.querySelector('[data-acs-multitract-close]'));
    }
    for (const closeButton of closeButtons) {
      closeButton.addEventListener('click', () => closeDialog(dialog));
    }
  }

  async function review() {
    const requestGeneration = ++generation;
    busy = true;
    workflow.invalidate();
    render();
    const reviewed = await workflow.review(selectionText);
    if (requestGeneration !== generation) return { status: 'superseded' };
    busy = false;
    render();
    const successTarget = host.querySelector('[data-acs-manual]')?.open
      ? '[data-acs-multitract-calculate]' : '[data-acs-quick]';
    host.querySelector(reviewed.status === 'available' ? successTarget : '[data-acs-multitract-input]')?.focus?.();
    return reviewed;
  }

  async function browseTracts() {
    if (catalogLoading) return;
    catalogLoading = true;
    catalogFailed = false;
    render();
    try {
      const source = await (loadSnapshot || fetchAcsPopulationVreSnapshot)();
      if (destroyed) return;
      if (source?.status !== 'available' || !source.snapshot?.rows?.length) throw new Error('No tracts');
      catalog = [...source.snapshot.rows].sort((a, b) => a.geoid.localeCompare(b.geoid));
    } catch {
      catalogFailed = true;
    } finally {
      catalogLoading = false;
      if (!destroyed) {
        render();
        host.querySelector(catalog ? '[data-acs-choice]' : '[data-acs-browse]')?.focus?.();
      }
    }
  }

  function calculate() {
    if (busy) return null;
    const outcome = workflow.calculate();
    if (!outcome) return null;
    render();
    const resultHost = host.querySelector('[data-acs-multitract-result]');
    resultHost?.focus?.({ preventScroll: true });
    resultHost?.scrollIntoView?.({ block: 'nearest' });
    return outcome;
  }

  const onDialogClose = () => {
    if (busy) {
      generation += 1;
      workflow.invalidate();
      busy = false;
    }
    returnFocus?.focus?.();
  };
  dialog.addEventListener('close', onDialogClose);
  const unsubscribeLanguage = onLanguageChange(render);
  render();

  return Object.freeze({
    open({ opener = null } = {}) {
      returnFocus = opener;
      openDialog(dialog);
      host.querySelector('[data-acs-multitract-input]')?.focus();
    },
    review,
    calculate,
    destroy() {
      destroyed = true;
      generation += 1;
      workflow.invalidate();
      unsubscribeLanguage();
      dialog.removeEventListener('close', onDialogClose);
      closeDialog(dialog);
      host.replaceChildren();
    },
  });
}
