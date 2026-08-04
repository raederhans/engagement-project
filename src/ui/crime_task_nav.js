function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

export function activateCrimeTaskTarget(button, {
  documentRef = globalThis.document,
  reducedMotion = prefersReducedMotion,
} = {}) {
  const targetId = button?.dataset?.taskTarget;
  const target = targetId ? documentRef?.getElementById?.(targetId) : null;
  if (!target) return false;
  target.scrollIntoView?.({
    block: 'start',
    inline: 'nearest',
    behavior: reducedMotion() ? 'auto' : 'smooth',
  });
  target.focus?.({ preventScroll: true });
  return true;
}

export function initCrimeTaskNavigation({ root = globalThis.document } = {}) {
  const navigation = root?.querySelector?.('[data-crime-task-nav]');
  if (!navigation || navigation.dataset.taskNavBound === 'true') return () => {};
  navigation.dataset.taskNavBound = 'true';
  const onClick = (event) => {
    const button = event.target?.closest?.('[data-task-target]');
    if (button && navigation.contains(button)) activateCrimeTaskTarget(button);
  };
  navigation.addEventListener('click', onClick);
  return () => {
    navigation.removeEventListener('click', onClick);
    delete navigation.dataset.taskNavBound;
  };
}
