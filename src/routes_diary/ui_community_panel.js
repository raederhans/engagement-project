import { createDiaryCard, createSectionTitle, createPrimaryButton } from './ui_common.js';

export function renderCommunityPanel(container, state = {}, handlers = {}) {
  container.innerHTML = '';
  const radius = state.radiusMeters ?? 1500;
  const segments = state.segments || [];
  const comments = state.comments || [];

  // Area focus
  const areaCard = createDiaryCard();
  areaCard.appendChild(createSectionTitle('Area focus'));
  const subtitle = document.createElement('div');
  subtitle.className = 'diary-community-subtitle';
  subtitle.textContent = 'Radius around map center';
  areaCard.appendChild(subtitle);
  const radiusLabel = document.createElement('div');
  radiusLabel.className = 'diary-muted-text';
  radiusLabel.textContent = `Radius: ${(radius / 1000).toFixed(2)} km`;
  areaCard.appendChild(radiusLabel);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = 500;
  slider.max = 3000;
  slider.step = 250;
  slider.value = radius;
  slider.style.width = '100%';
  slider.addEventListener('input', () => {
    const val = Number(slider.value);
    radiusLabel.textContent = `Radius: ${(val / 1000).toFixed(2)} km`;
  });
  slider.addEventListener('change', () => {
    const val = Number(slider.value);
    handlers.onRadiusChange?.(val);
  });
  areaCard.appendChild(slider);
  container.appendChild(areaCard);

  // High concern segments
  const segmentsCard = createDiaryCard();
  segmentsCard.appendChild(createSectionTitle('High concern segments'));
  const segList = document.createElement('div');
  segList.style.display = 'flex';
  segList.style.flexDirection = 'column';
  segList.style.gap = '8px';
  segments.forEach((seg) => {
    const btn = document.createElement('button');
    btn.type = 'button';
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
    btn.addEventListener('click', () => handlers.onSelectSegment?.(seg));
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
    row.innerHTML = `<strong style="color:#0f172a;">${c.user}</strong> <span style="color:#94a3b8;">${c.ago}</span><div style="margin-top:2px;color:#111827;">${c.text}</div>`;
    list.appendChild(row);
  });
  commentsCard.appendChild(list);

  const form = document.createElement('form');
  form.style.display = 'flex';
  form.style.gap = '8px';
  form.style.marginTop = '8px';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Add a comment...';
  input.className = 'diary-select';
  input.style.flex = '1';
  const postBtn = createPrimaryButton('Post');
  postBtn.style.padding = '8px 12px';
  form.appendChild(input);
  form.appendChild(postBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = (input.value || '').trim();
    if (!val) return;
    handlers.onPostComment?.(val);
    input.value = '';
  });
  commentsCard.appendChild(form);
  container.appendChild(commentsCard);
}
