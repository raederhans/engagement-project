import {
  getLanguage,
  onLanguageChange,
  t,
} from '../i18n/index.js';
import './messages.js';
import { buildPublicRouteScenarioViewModel } from './model.js';

const METRIC_KEYS = Object.freeze([
  'travelTime',
  'distance',
  'detour',
  'historicalReportedIncidentExposure',
  'crash',
  'highInjuryNetwork',
  'accessibility',
  'mapMatchQuality',
  'freshness',
  'uncertainty',
]);

function element(documentRef, tagName, options = {}) {
  const node = documentRef.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes || {})) {
    node.setAttribute(name, value);
  }
  return node;
}

function translatedValue(value) {
  const translated = t(`publicRoutes.value.${value}`);
  return translated === `publicRoutes.value.${value}` ? String(value) : translated;
}

function formattedMetric(metric) {
  if (metric.status !== 'available') return t('publicRoutes.unavailable');
  if (typeof metric.value === 'string') return translatedValue(metric.value);
  const number = new Intl.NumberFormat(getLanguage(), { maximumFractionDigits: 1 });
  if (metric.unit === 'seconds') {
    return `${number.format(metric.value / 60)} ${t('publicRoutes.unit.minutes')}`;
  }
  if (metric.unit === 'meters' && metric.value >= 1_000) {
    return `${number.format(metric.value / 1_000)} ${t('publicRoutes.unit.kilometers')}`;
  }
  if (['route-share', 'matched-edge-share'].includes(metric.unit)) {
    return `${number.format(metric.value * 100)}${t('publicRoutes.unit.percent')}`;
  }
  const value = number.format(metric.value);
  if (!metric.unit) return value;
  const unitKey = `publicRoutes.unit.${metric.unit}`;
  const unit = t(unitKey);
  return `${value} ${unit === unitKey ? metric.unit : unit}`;
}

function appendMetric(documentRef, list, key, metric) {
  const row = element(documentRef, 'div', { className: 'public-route-card__metric' });
  const term = element(documentRef, 'dt', {
    text: t(`publicRoutes.metric.${key}`),
  });
  const detail = element(documentRef, 'dd');
  detail.append(element(documentRef, 'strong', { text: formattedMetric(metric) }));
  row.append(term, detail);
  list.append(row);
}

function routeCard(documentRef, card) {
  const article = element(documentRef, 'article', {
    className: 'public-route-card',
    attributes: {
      'data-public-route-card': card.candidateId,
      'data-public-route-role': card.role,
    },
  });
  const header = element(documentRef, 'header', { className: 'public-route-card__header' });
  const copy = element(documentRef, 'div');
  copy.append(element(documentRef, 'p', {
    className: 'public-route-card__roles',
    text: card.roles.map((role) => t(`publicRoutes.role.${role}`)).join(' · '),
  }));
  copy.append(element(documentRef, 'h3', { text: card.label }));
  const pareto = element(documentRef, 'span', {
    className: `public-route-card__pareto${card.pareto ? ' is-pareto' : ''}`,
    text: card.pareto ? t('publicRoutes.paretoYes') : t('publicRoutes.paretoNo'),
  });
  header.append(copy, pareto);
  const metrics = element(documentRef, 'dl', { className: 'public-route-card__metrics' });
  for (const key of METRIC_KEYS.slice(0, 4)) appendMetric(documentRef, metrics, key, card.metrics[key]);
  const details = element(documentRef, 'details', { className: 'public-route-card__details workspace-disclosure' });
  details.append(element(documentRef, 'summary', { text: t('publicRoutes.moreMetrics') }));
  const secondary = element(documentRef, 'dl', { className: 'public-route-card__metrics' });
  for (const key of METRIC_KEYS.slice(4)) appendMetric(documentRef, secondary, key, card.metrics[key]);
  details.append(secondary);
  article.append(header, metrics, details);
  return article;
}

export function createPublicRouteAlternativesUi({
  dialog,
  host,
  opener,
  artifact,
  documentRef = globalThis.document,
}) {
  if (!dialog || !host || !opener || !artifact || !documentRef) {
    throw new TypeError('public route alternatives UI requires dialog, host, opener and artifact');
  }
  let selectedScenarioId = artifact.scenarios[0].scenarioId;
  let sortMetric = '';

  const render = () => {
    const locale = getLanguage();
    const view = buildPublicRouteScenarioViewModel(artifact, selectedScenarioId, locale);
    const orderedCards = [...view.cards];
    if (sortMetric) orderedCards.sort((a, b) => {
      const first = a.metrics[sortMetric];
      const second = b.metrics[sortMetric];
      return (first.status === 'available' ? first.value : Infinity)
        - (second.status === 'available' ? second.value : Infinity);
    });
    const surface = element(documentRef, 'section', {
      className: 'public-route-surface',
      attributes: { 'data-public-route-surface': '', 'data-public-route-status': view.status },
    });
    const header = element(documentRef, 'header', { className: 'public-route-surface__header' });
    const heading = element(documentRef, 'div');
    heading.append(element(documentRef, 'h2', {
      text: t('publicRoutes.title'),
      attributes: { id: 'public-route-title' },
    }));
    const close = element(documentRef, 'button', {
      className: 'button button--secondary public-route-surface__close',
      text: '×',
      attributes: {
        type: 'button',
        'aria-label': t('publicRoutes.close'),
        'data-public-route-close': '',
      },
    });
    close.addEventListener('click', () => dialog.close());
    header.append(heading, close);

    const disclosure = element(documentRef, 'p', {
      className: 'public-route-surface__disclosure',
      text: t('publicRoutes.summary'),
      attributes: { id: 'public-route-description' },
    });
    const controls = element(documentRef, 'div', { className: 'public-route-surface__controls' });
    const label = element(documentRef, 'label', {
      text: t('publicRoutes.scenarioLabel'),
      attributes: { for: 'public-route-scenario-select' },
    });
    const select = element(documentRef, 'select', {
      className: 'field',
      attributes: { id: 'public-route-scenario-select', 'data-public-route-scenario': '' },
    });
    for (const scenario of artifact.scenarios) {
      const option = element(documentRef, 'option', {
        text: scenario.label[locale],
        attributes: { value: scenario.scenarioId },
      });
      option.selected = scenario.scenarioId === selectedScenarioId;
      select.append(option);
    }
    select.addEventListener('change', () => {
      selectedScenarioId = select.value;
      render();
      host.querySelector('[data-public-route-scenario]')?.focus();
    });
    const badges = element(documentRef, 'div', { className: 'public-route-surface__badges' });
    badges.append(element(documentRef, 'span', { text: t('publicRoutes.walkingOnly') }));
    controls.append(label, select, badges);
    const sortLabel = element(documentRef, 'label', { text: t('publicRoutes.sort'), attributes: { for: 'public-route-sort' } });
    const sort = element(documentRef, 'select', { className: 'field', attributes: { id: 'public-route-sort' } });
    for (const key of ['', 'travelTime', 'distance', 'historicalReportedIncidentExposure']) {
      const option = element(documentRef, 'option', { text: t(key ? `publicRoutes.metric.${key}` : 'publicRoutes.originalOrder') });
      option.value = key;
      option.selected = key === sortMetric;
      sort.append(option);
    }
    sort.addEventListener('change', () => {
      sortMetric = sort.value;
      render();
      host.querySelector('#public-route-sort')?.focus();
    });
    controls.append(sortLabel, sort);

    const context = element(documentRef, 'div', { className: 'public-route-surface__context' });
    context.append(element(documentRef, 'strong', { text: `${view.origin} → ${view.destination}` }));

    const notice = element(documentRef, 'div', {
      className: 'public-route-surface__notice',
      attributes: { role: 'status', 'aria-live': 'polite', 'data-public-route-notice': '' },
    });
    if (view.sensitivity.reasonCode === 'only-one-route-admitted') {
      notice.append(element(documentRef, 'p', { text: t('publicRoutes.onlyOne') }));
    } else if (view.status === 'limited') {
      notice.append(element(documentRef, 'p', { text: t('publicRoutes.gateClosed') }));
    } else {
      notice.append(element(documentRef, 'p', {
        text: t(view.sensitivity.status === 'unstable'
          ? 'publicRoutes.sensitivityUnstable'
          : 'publicRoutes.sensitivityStable'),
      }));
    }
    const notes = element(documentRef, 'details', { className: 'public-route-surface__notes' });
    notes.append(element(documentRef, 'summary', { text: t('publicRoutes.notes') }));
    notes.append(element(documentRef, 'p', { text: t('publicRoutes.disclosure') }));
    notes.append(element(documentRef, 'p', { text: t('publicRoutes.copyBoundary') }));

    const cards = element(documentRef, 'div', {
      className: 'public-route-cards',
      attributes: { 'data-public-route-cards': '' },
    });
    for (const candidate of orderedCards) cards.append(routeCard(documentRef, candidate));
    const comparison = element(documentRef, 'div', {
      className: 'public-route-comparison',
      attributes: { tabindex: '0', role: 'region', 'aria-label': t('publicRoutes.comparison') },
    });
    const table = element(documentRef, 'table');
    table.append(element(documentRef, 'caption', { text: t('publicRoutes.comparison') }));
    const tableHead = element(documentRef, 'thead');
    const headings = element(documentRef, 'tr');
    headings.append(element(documentRef, 'th', { text: t('publicRoutes.measure'), attributes: { scope: 'col' } }));
    for (const candidate of orderedCards) {
      headings.append(element(documentRef, 'th', { text: candidate.label, attributes: { scope: 'col' } }));
    }
    tableHead.append(headings);
    const tableBody = element(documentRef, 'tbody');
    for (const key of METRIC_KEYS.slice(0, 4)) {
      const row = element(documentRef, 'tr');
      row.append(element(documentRef, 'th', { text: t(`publicRoutes.metric.${key}`), attributes: { scope: 'row' } }));
      for (const candidate of orderedCards) row.append(element(documentRef, 'td', { text: formattedMetric(candidate.metrics[key]) }));
      tableBody.append(row);
    }
    table.append(tableHead, tableBody);
    comparison.append(table);
    const routeDetails = element(documentRef, 'details', { className: 'workspace-disclosure public-route-details' });
    routeDetails.append(element(documentRef, 'summary', { text: t('publicRoutes.routeDetails') }), cards);
    surface.append(header, disclosure, controls, context, notice, comparison, routeDetails, notes);
    host.replaceChildren(surface);
    dialog.setAttribute('aria-labelledby', 'public-route-title');
    dialog.setAttribute('aria-describedby', 'public-route-description');
  };

  const restoreFocus = () => opener.focus();
  const releaseLanguage = onLanguageChange(render);
  dialog.addEventListener('close', restoreFocus);
  render();

  return Object.freeze({
    open() {
      if (!dialog.open) dialog.showModal();
      host.querySelector('[data-public-route-close]')?.focus();
    },
    getSelectedScenarioId: () => selectedScenarioId,
    destroy() {
      releaseLanguage();
      dialog.removeEventListener('close', restoreFocus);
      host.replaceChildren();
    },
  });
}
