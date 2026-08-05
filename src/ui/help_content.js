import '../i18n/help.js';
import { t } from '../i18n/index.js';

const HELP_SECTIONS = Object.freeze([
  ['help-overview', 'help.navOverview'],
  ['help-sources', 'help.navSources'],
  ['help-methods', 'help.navMethods'],
  ['help-limitations', 'help.navLimitations'],
]);

const CRIME_SOURCES = Object.freeze([
  { label: 'help.crimeSourceIncidents', detail: 'help.crimeSourceIncidentsDetail', href: 'https://opendataphilly.org/datasets/crime-incidents/' },
  { label: 'help.crimeSourceBoundaries', detail: 'help.crimeSourceBoundariesDetail', href: 'https://policegis.phila.gov/arcgis/rest/services/POLICE/Boundaries/MapServer/1' },
  { label: 'help.crimeSourceTracts', detail: 'help.crimeSourceTractsDetail', href: 'https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_geography_details.html' },
  { label: 'help.crimeSourcePopulation', detail: 'help.crimeSourcePopulationDetail', href: 'https://www.census.gov/programs-surveys/acs/data.html' },
  { label: 'help.crimeSourceBasemap', detail: 'help.crimeSourceBasemapDetail', href: 'https://www.openstreetmap.org/copyright' },
]);

const DIARY_SOURCES = Object.freeze([
  { label: 'help.diarySourceLocal', detail: 'help.diarySourceLocalDetail' },
  { label: 'help.diarySourceDemo', detail: 'help.diarySourceDemoDetail' },
  { label: 'help.diarySourceBasemap', detail: 'help.diarySourceBasemapDetail', href: 'https://www.openstreetmap.org/copyright' },
]);

const MODE_CONTENT = Object.freeze({
  crime: {
    title: 'help.crimeTitle',
    description: 'help.crimeDescription',
    status: 'help.crimeStatus',
    steps: ['help.crimeStep1', 'help.crimeStep2', 'help.crimeStep3'],
    sources: CRIME_SOURCES,
    methods: [
      ['help.methodTimeTitle', 'help.crimeMethodTime'],
      ['help.methodAreaTitle', 'help.crimeMethodBuffer'],
      ['help.methodFilterTitle', 'help.crimeMethodFilters'],
      ['help.methodPer10kTitle', 'help.crimeMethodPer10k'],
      ['help.methodClassificationTitle', 'help.crimeMethodClassification'],
      ['help.methodMapTitle', 'help.crimeMethodMap'],
      ['help.methodHeatTitle', 'help.crimeMethodHeat'],
    ],
    limitations: ['help.crimeLimitReporting', 'help.crimeLimitLocation', 'help.crimeLimitPopulation', 'help.crimeLimitInterpretation'],
  },
  diary: {
    title: 'help.diaryTitle',
    description: 'help.diaryDescription',
    status: 'help.diaryStatus',
    steps: ['help.diaryStep1', 'help.diaryStep2', 'help.diaryStep3'],
    sources: DIARY_SOURCES,
    methods: [
      ['help.diaryMethodRatingsTitle', 'help.diaryMethodRatings'],
      ['help.diaryMethodInsightsTitle', 'help.diaryMethodInsights'],
      ['help.diaryMethodStorageTitle', 'help.diaryMethodStorage'],
    ],
    limitations: ['help.diaryLimitPersonal', 'help.diaryLimitSample', 'help.diaryLimitStorage'],
  },
});

function renderNav() {
  return HELP_SECTIONS.map(([id, key], index) => `
    <a class="about-nav__link" href="#${id}">
      <span aria-hidden="true">0${index + 1}</span>
      <span data-i18n="${key}">${t(key)}</span>
    </a>
  `).join('');
}

function renderSteps(keys) {
  return keys.map((key, index) => `
    <li class="about-steps__item">
      <span class="about-steps__number" aria-hidden="true">${index + 1}</span>
      <span data-i18n="${key}">${t(key)}</span>
    </li>
  `).join('');
}

function renderSources(sources) {
  return sources.map(({ label, detail, href }) => `
    <article class="about-source-card">
      <div class="about-source-card__marker" aria-hidden="true"></div>
      <div>
        <h4 data-i18n="${label}">${t(label)}</h4>
        <p data-i18n="${detail}">${t(detail)}</p>
        ${href ? `<a href="${href}" target="_blank" rel="noopener noreferrer" data-i18n="help.visitSource">${t('help.visitSource')}</a>` : ''}
      </div>
    </article>
  `).join('');
}

function renderMethods(methods) {
  return methods.map(([title, detail]) => `
    <div class="about-method">
      <dt data-i18n="${title}">${t(title)}</dt>
      <dd data-i18n="${detail}">${t(detail)}</dd>
    </div>
  `).join('');
}

function renderLimitations(keys) {
  return keys.map((key) => `<li><span data-i18n="${key}">${t(key)}</span></li>`).join('');
}

export function getAboutContent(mode = 'crime') {
  const modeKey = mode === 'diary' ? 'diary' : 'crime';
  const content = MODE_CONTENT[modeKey];
  return `
    <div class="about-content" data-help-mode="${modeKey}">
      <header class="about-hero">
        <p class="about-hero__eyebrow" data-i18n="help.eyebrow">${t('help.eyebrow')}</p>
        <h2 id="about-title" class="about-hero__title" data-i18n="${content.title}">${t(content.title)}</h2>
        <p id="about-intro" class="about-hero__intro" data-i18n="${content.description}">${t(content.description)}</p>
        <div class="about-hero__status">
          <span class="about-hero__status-mark" aria-hidden="true">PHL</span>
          <div>
            <strong data-i18n="help.readingNote">${t('help.readingNote')}</strong>
            <p data-i18n="${content.status}">${t(content.status)}</p>
          </div>
        </div>
      </header>

      <nav class="about-nav" data-i18n-aria-label="help.navLabel" aria-label="${t('help.navLabel')}">${renderNav()}</nav>

      <main class="about-body">
        <section id="help-overview" class="about-section" aria-labelledby="help-overview-title">
          <div class="about-section__heading"><span aria-hidden="true">01</span><div><p data-i18n="help.sectionPrimer">${t('help.sectionPrimer')}</p><h3 id="help-overview-title" data-i18n="help.overviewTitle">${t('help.overviewTitle')}</h3></div></div>
          <ol class="about-steps">${renderSteps(content.steps)}</ol>
        </section>

        <section id="help-sources" class="about-section" aria-labelledby="help-sources-title">
          <div class="about-section__heading"><span aria-hidden="true">02</span><div><p data-i18n="help.sectionEvidence">${t('help.sectionEvidence')}</p><h3 id="help-sources-title" data-i18n="help.sourcesTitle">${t('help.sourcesTitle')}</h3></div></div>
          <p class="about-section__lede" data-i18n="help.sourcesIntro">${t('help.sourcesIntro')}</p>
          <div class="about-source-grid">${renderSources(content.sources)}</div>
        </section>

        <section id="help-methods" class="about-section" aria-labelledby="help-methods-title">
          <div class="about-section__heading"><span aria-hidden="true">03</span><div><p data-i18n="help.sectionMethod">${t('help.sectionMethod')}</p><h3 id="help-methods-title" data-i18n="help.methodsTitle">${t('help.methodsTitle')}</h3></div></div>
          <dl class="about-methods">${renderMethods(content.methods)}</dl>
        </section>

        <section id="help-limitations" class="about-section about-section--caution" aria-labelledby="help-limitations-title">
          <div class="about-section__heading"><span aria-hidden="true">04</span><div><p data-i18n="help.sectionCaution">${t('help.sectionCaution')}</p><h3 id="help-limitations-title" data-i18n="help.limitationsTitle">${t('help.limitationsTitle')}</h3></div></div>
          <ul class="about-limitations">${renderLimitations(content.limitations)}</ul>
        </section>

        <footer class="about-footer">
          <p data-i18n="help.footerNote">${t('help.footerNote')}</p>
          <a href="https://github.com/raederhans/engagement-project" target="_blank" rel="noopener noreferrer" data-i18n="help.sourceLink">${t('help.sourceLink')}</a>
        </footer>
      </main>
    </div>
  `;
}
