import { createDiaryCard, createSectionTitle } from './ui_common.js';
import '../i18n/p1.js';
import { setTranslatedAttribute, setTranslatedText, t } from '../i18n/index.js';

export function createSampleCommunityModel() {
  return Object.freeze({
    segments: Object.freeze([
      { id: 'seg_c1', name: 'South St Bridge (westbound)', score: 1.8, tagsKey: 'demo.segment1Tags' },
      { id: 'seg_c2', name: '34th & Walnut (eastbound)', score: 2.2, tagsKey: 'demo.segment2Tags' },
      { id: 'seg_c3', name: 'Chestnut St (river to 34th)', score: 2.9, tagsKey: 'demo.segment3Tags' },
    ]),
    observations: Object.freeze([
      { id: 'c1', label: 'Example 1', labelKey: 'diary.sampleExample1', sample: true, text: 'South St Bridge can feel uncomfortable after dark.', textKey: 'diary.sampleObservation1' },
      { id: 'c2', label: 'Example 2', labelKey: 'diary.sampleExample2', sample: true, text: 'Watch for vehicles edging into the bike lane near 34th.', textKey: 'diary.sampleObservation2' },
      { id: 'c3', label: 'Example 3', labelKey: 'diary.sampleExample3', sample: true, text: 'This Pine Street example notes smoother pavement and fewer parked obstructions.', textKey: 'diary.sampleObservation3' },
    ]),
  });
}

export function renderCommunityPanel(container, state = {}) {
  container.innerHTML = '';
  const segments = state.segments || [];
  const observations = state.observations || [];

  const notice = createDiaryCard();
  const communityTitle = createSectionTitle(t('diary.sampleCommunity'));
  setTranslatedText(communityTitle, 'diary.sampleCommunity');
  notice.appendChild(communityTitle);
  const noticeText = document.createElement('div');
  noticeText.className = 'diary-muted-text';
  setTranslatedText(noticeText, 'diary.communitySummary');
  const fullNotice = document.createElement('span');
  fullNotice.hidden = true;
  setTranslatedText(fullNotice, 'diary.communityNotice');
  notice.appendChild(noticeText);
  notice.appendChild(fullNotice);
  container.appendChild(notice);

  // Static illustrative experience ratings; never community or safety evidence.
  const segmentsCard = createDiaryCard();
  const concernTitle = createSectionTitle(t('diary.sampleRouteRatings'));
  setTranslatedText(concernTitle, 'diary.sampleRouteRatings');
  segmentsCard.appendChild(concernTitle);
  const segList = document.createElement('div');
  segList.className = 'diary-community-list';
  segments.forEach((seg) => {
    const btn = document.createElement('div');
    btn.className = 'diary-community-item';
    const title = document.createElement('div');
    title.className = 'diary-community-item__title';
    title.textContent = seg.name;
    const meta = document.createElement('div');
    meta.className = 'diary-community-item__meta';
    const tags = document.createElement('div');
    tags.className = 'diary-community-item__tags';
    setTranslatedText(tags, 'diary.tags', { tags: seg.tagsKey ? t(seg.tagsKey) : seg.tags });
    const badge = document.createElement('div');
    badge.className = 'diary-score-pill';
    badge.textContent = seg.score.toFixed(1);
    setTranslatedAttribute(badge, 'diary.sampleScoreLabel', 'aria-label', { score: seg.score.toFixed(1) });
    meta.appendChild(tags);
    meta.appendChild(badge);
    btn.appendChild(title);
    btn.appendChild(meta);
    segList.appendChild(btn);
  });
  segmentsCard.appendChild(segList);
  container.appendChild(segmentsCard);

  // Comments
  const commentsCard = createDiaryCard();
  const commentsTitle = createSectionTitle(t('diary.exampleObservations'));
  setTranslatedText(commentsTitle, 'diary.exampleObservations');
  commentsCard.appendChild(commentsTitle);
  const list = document.createElement('div');
  list.className = 'diary-community-observations';
  observations.forEach((observation) => {
    const row = document.createElement('div');
    row.className = 'diary-community-observation';
    const author = document.createElement('strong');
    author.className = 'diary-community-observation__author';
    if (observation.labelKey) setTranslatedText(author, observation.labelKey);
    else author.textContent = observation.label;
    const text = document.createElement('div');
    text.className = 'diary-community-observation__text';
    if (observation.textKey) setTranslatedText(text, observation.textKey);
    else text.textContent = observation.text;
    row.append(author, text);
    list.appendChild(row);
  });
  commentsCard.appendChild(list);

  container.appendChild(commentsCard);
}
