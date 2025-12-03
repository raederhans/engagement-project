export function createDiaryCard(className = '') {
  const el = document.createElement('div');
  el.className = `diary-card${className ? ` ${className}` : ''}`;
  return el;
}

export function createSectionTitle(text) {
  const el = document.createElement('div');
  el.className = 'diary-section-title';
  el.textContent = text;
  return el;
}

export function createPill(label, { active = false } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'diary-pill';
  if (active) btn.classList.add('is-active');
  btn.textContent = label;
  return btn;
}

export function createPrimaryButton(label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'diary-btn-primary';
  btn.textContent = label;
  return btn;
}

export function createSecondaryButton(label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'diary-btn-secondary';
  btn.textContent = label;
  return btn;
}

export function createMutedCard() {
  const el = document.createElement('div');
  el.className = 'diary-muted-card';
  return el;
}
