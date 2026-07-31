import { createDiaryCard, createSectionTitle } from './ui_common.js';

export function renderCommunityPanel(container, state = {}) {
  container.innerHTML = '';
  const segments = state.segments || [];
  const comments = state.comments || [];

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
    btn.className = 'diary-history-item';
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
  commentsCard.appendChild(createSectionTitle('Community comments'));
  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '6px';
  comments.forEach((c) => {
    const row = document.createElement('div');
    row.style.borderBottom = '1px solid #e5e7eb';
    row.style.paddingBottom = '6px';
    row.style.fontSize = '12px';
    const author = document.createElement('strong');
    author.style.color = '#0f172a';
    author.textContent = c.user;
    const age = document.createElement('span');
    age.style.color = '#94a3b8';
    age.textContent = ` ${c.ago}`;
    const text = document.createElement('div');
    text.style.marginTop = '2px';
    text.style.color = '#111827';
    text.textContent = c.text;
    row.append(author, age, text);
    list.appendChild(row);
  });
  commentsCard.appendChild(list);

  container.appendChild(commentsCard);
}
