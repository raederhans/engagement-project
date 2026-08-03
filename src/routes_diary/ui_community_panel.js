import { createDiaryCard, createSectionTitle } from './ui_common.js';
import { setTranslatedText, t } from '../i18n/index.js';

export function renderCommunityPanel(container, state = {}) {
  container.innerHTML = '';
  const segments = state.segments || [];
  const comments = state.comments || [];

  const notice = createDiaryCard();
  const communityTitle = createSectionTitle(t('diary.sampleCommunity'));
  setTranslatedText(communityTitle, 'diary.sampleCommunity');
  notice.appendChild(communityTitle);
  const noticeText = document.createElement('div');
  noticeText.className = 'diary-muted-text';
  setTranslatedText(noticeText, 'diary.communityNotice');
  notice.appendChild(noticeText);
  container.appendChild(notice);

  // High concern segments
  const segmentsCard = createDiaryCard();
  const concernTitle = createSectionTitle(t('diary.highConcern'));
  setTranslatedText(concernTitle, 'diary.highConcern');
  segmentsCard.appendChild(concernTitle);
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
    setTranslatedText(tags, 'diary.tags', { tags: seg.tagsKey ? t(seg.tagsKey) : seg.tags });
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
  const commentsTitle = createSectionTitle(t('diary.communityComments'));
  setTranslatedText(commentsTitle, 'diary.communityComments');
  commentsCard.appendChild(commentsTitle);
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
    age.textContent = ` ${c.agoKey ? t(c.agoKey) : c.ago}`;
    const text = document.createElement('div');
    text.style.marginTop = '2px';
    text.style.color = '#111827';
    text.textContent = c.textKey ? t(c.textKey) : c.text;
    row.append(author, age, text);
    list.appendChild(row);
  });
  commentsCard.appendChild(list);

  container.appendChild(commentsCard);
}
