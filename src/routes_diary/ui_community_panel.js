import { createDiaryCard, createSectionTitle } from './ui_common.js';

export function createSampleCommunityModel() {
  return Object.freeze({
    segments: Object.freeze([
      { id: 'seg_c1', name: 'South St Bridge (westbound)', score: 1.8, tags: 'poor lighting, aggressive drivers' },
      { id: 'seg_c2', name: '34th & Walnut (eastbound)', score: 2.2, tags: 'construction, potholes' },
      { id: 'seg_c3', name: 'Chestnut St (river to 34th)', score: 2.9, tags: 'heavy traffic' },
    ]),
    observations: Object.freeze([
      { id: 'c1', label: 'Example 1', sample: true, text: 'South St Bridge can feel uncomfortable after dark.' },
      { id: 'c2', label: 'Example 2', sample: true, text: 'Watch for vehicles edging into the bike lane near 34th.' },
      { id: 'c3', label: 'Example 3', sample: true, text: 'Pine Street illustrates a calmer route option in this sample.' },
    ]),
  });
}

export function renderCommunityPanel(container, state = {}) {
  container.innerHTML = '';
  const segments = state.segments || [];
  const observations = state.observations || [];

  const notice = createDiaryCard();
  notice.appendChild(createSectionTitle('Sample Community'));
  const noticeText = document.createElement('div');
  noticeText.className = 'diary-muted-text';
  noticeText.textContent = 'Illustrative, read-only sample data. No comments or ratings are shared with other people.';
  notice.appendChild(noticeText);
  container.appendChild(notice);

  // High concern segments
  const segmentsCard = createDiaryCard();
  segmentsCard.appendChild(createSectionTitle('High concern segments'));
  const segList = document.createElement('div');
  segList.style.display = 'flex';
  segList.style.flexDirection = 'column';
  segList.style.gap = '8px';
  segments.forEach((seg) => {
    const btn = document.createElement('div');
    btn.className = 'diary-community-item';
    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '13px';
    title.textContent = seg.name;
    const meta = document.createElement('div');
    meta.style.display = 'flex';
    meta.style.justifyContent = 'space-between';
    meta.style.alignItems = 'center';
    const tags = document.createElement('div');
    tags.style.fontSize = '12px';
    tags.style.color = '#475569';
    tags.textContent = `Tags: ${seg.tags}`;
    const badge = document.createElement('div');
    badge.className = 'diary-score-pill';
    badge.classList.add(seg.score < 2.5 ? 'is-bad' : seg.score < 4 ? 'is-mid' : 'is-good');
    badge.textContent = seg.score.toFixed(1);
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
  commentsCard.appendChild(createSectionTitle('Example observations'));
  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '6px';
  observations.forEach((observation) => {
    const row = document.createElement('div');
    row.style.borderBottom = '1px solid #e5e7eb';
    row.style.paddingBottom = '6px';
    row.style.fontSize = '12px';
    const author = document.createElement('strong');
    author.style.color = '#0f172a';
    author.textContent = observation.label;
    const badge = document.createElement('span');
    badge.className = 'diary-sample-badge';
    badge.textContent = 'Sample';
    const text = document.createElement('div');
    text.style.marginTop = '2px';
    text.style.color = '#111827';
    text.textContent = observation.text;
    row.append(author, badge, text);
    list.appendChild(row);
  });
  commentsCard.appendChild(list);

  container.appendChild(commentsCard);
}
