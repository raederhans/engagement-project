import './styles.css';

import {
  acsAggregationTableHtml,
} from '../acs_aggregation.js';
import { getLanguage, onLanguageChange } from '../i18n/index.js';
import { createAcsMultitractWorkflow } from './workflow.js';
import {
  acsMultitractProductHtml,
  acsMultitractReason,
  acsSelectionReviewHtml,
  getAcsMultitractCopy,
} from './view.js';

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

export function createAcsMultitractController({
  dialog,
  loadSnapshot,
  onSourceHealthObservation = () => {},
  onEvidenceRecord = () => {},
} = {}) {
  if (!dialog?.querySelector) throw new TypeError('ACS multi-tract dialog is required');
  const host = dialog.querySelector('[data-acs-multitract-host]');
  if (!host) throw new TypeError('ACS multi-tract host is required');

  let returnFocus = null;
  let generation = 0;
  let selectionText = '';
  let busy = false;
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
    host.innerHTML = acsMultitractProductHtml(locale);
    const input = host.querySelector('[data-acs-multitract-input]');
    const reviewButton = host.querySelector('[data-acs-multitract-review]');
    const calculateButton = host.querySelector('[data-acs-multitract-calculate]');
    const status = host.querySelector('[data-acs-multitract-status]');
    const reviewHost = host.querySelector('[data-acs-multitract-review-host]');
    const resultHost = host.querySelector('[data-acs-multitract-result]');
    const { reviewed, outcome } = workflow.getState();

    input.value = selectionText;
    reviewButton.disabled = busy;
    calculateButton.disabled = busy || reviewed?.status !== 'available';
    dialog.setAttribute('aria-busy', String(busy));
    if (busy) status.textContent = copy.loading;
    else if (reviewed?.status === 'available') status.textContent = copy.ready;
    else if (reviewed) status.textContent = acsMultitractReason(reviewed.reason, locale);
    else status.textContent = copy.idle;
    if (reviewed) reviewHost.innerHTML = acsSelectionReviewHtml(reviewed, { locale });
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
    return reviewed;
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
      generation += 1;
      workflow.invalidate();
      unsubscribeLanguage();
      dialog.removeEventListener('close', onDialogClose);
      closeDialog(dialog);
      host.replaceChildren();
    },
  });
}
