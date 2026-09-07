import {
  CRIME_RADIUS_POLICY,
  isCrimeRadiusPreset,
  isValidCrimeRadius,
  normalizeCrimeRadius,
} from '../state/crime_radius_policy.js';

export function describeRadiusControlState(value) {
  const radius = normalizeCrimeRadius(value);
  const customVisible = !isCrimeRadiusPreset(radius);
  return {
    selectValue: customVisible ? 'custom' : String(radius),
    customValue: String(radius),
    customVisible,
  };
}

export function configureRadiusControls({ select, input, translateCustom } = {}) {
  if (input) {
    input.min = String(CRIME_RADIUS_POLICY.min);
    input.max = String(CRIME_RADIUS_POLICY.max);
    input.step = '1';
  }
  if (!select) return;
  const documentRef = select.ownerDocument || globalThis.document;
  if (!documentRef?.createElement) return;
  const options = CRIME_RADIUS_POLICY.presets.map((radius) => {
    const option = documentRef.createElement('option');
    option.value = String(radius);
    option.textContent = `${radius.toLocaleString('en-US')} m`;
    return option;
  });
  const custom = documentRef.createElement('option');
  custom.value = 'custom';
  custom.dataset.i18n = 'crime.custom';
  custom.textContent = 'Custom';
  translateCustom?.(custom);
  select.replaceChildren(...options, custom);
}

export function bindRadiusControls({
  select,
  input,
  customRow,
  readRadius,
  writeRadius,
  translateCustom,
} = {}) {
  configureRadiusControls({ select, input, translateCustom });

  const sync = () => {
    const state = describeRadiusControlState(readRadius?.());
    if (select) select.value = state.selectValue;
    if (input) input.value = state.customValue;
    if (customRow) customRow.hidden = !state.customVisible;
    return state;
  };
  const apply = (value) => {
    if (!isValidCrimeRadius(value)) return false;
    const radius = Number(value);
    if (readRadius?.() === radius) return false;
    writeRadius?.(radius);
    return true;
  };

  select?.addEventListener('change', () => {
    if (select.value === 'custom') {
      if (customRow) customRow.hidden = false;
      input?.focus();
      return;
    }
    apply(select.value);
    sync();
  });
  input?.addEventListener('change', () => {
    if (input.reportValidity()) {
      apply(input.value);
      sync();
    }
  });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && input.reportValidity()) {
      event.preventDefault();
      apply(input.value);
      sync();
    }
  });

  return { sync, apply };
}
