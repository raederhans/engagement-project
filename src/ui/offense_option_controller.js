export function createOffenseOptionController({
  select,
  readSelectedCodes,
  writeGroups,
  readWindow,
  fetchAvailableCodes,
  normalizeCodes,
  createOption,
  localizeCode,
  syncHighlights,
  fitRows,
  renderStatus,
  notify,
  warn = () => {},
}) {
  let requestGeneration = 0;

  async function populate(values, { preserveSelection = false, notify: shouldNotify = true } = {}) {
    const generation = ++requestGeneration;
    let requestedCodes = preserveSelection ? normalizeCodes(readSelectedCodes()) : [];
    writeGroups(values, { resetHighlights: !preserveSelection });

    if (select) {
      if (values.length === 0) {
        renderStatus('crime.selectGroupFirst');
        select.disabled = true;
        fitRows(select);
        if (!preserveSelection) syncHighlights([]);
      } else {
        select.disabled = false;
        if (!preserveSelection) renderStatus('crime.loadingCodes');
        try {
          const availableCodes = await fetchAvailableCodes({ ...readWindow(), groups: values });
          if (generation !== requestGeneration) return { applied: false };
          if (preserveSelection) requestedCodes = normalizeCodes(readSelectedCodes());

          select.innerHTML = '';
          const renderedCodes = preserveSelection
            ? [...new Set([...availableCodes, ...requestedCodes])]
            : availableCodes;
          if (renderedCodes.length === 0) {
            renderStatus('crime.noSubcodes');
            syncHighlights([]);
          } else {
            for (const code of renderedCodes) {
              const option = createOption();
              option.value = code;
              option.textContent = localizeCode(code);
              option.selected = requestedCodes.includes(code);
              select.appendChild(option);
            }
            syncHighlights(readSelectedCodes());
          }
          fitRows(select);
        } catch (error) {
          if (generation !== requestGeneration) return { applied: false };
          warn(error);
          if (!preserveSelection) renderStatus('crime.codeLoadError');
          if (shouldNotify) notify();
          return { applied: false, error };
        }
      }
    }
    if (shouldNotify) notify();
    return { applied: true };
  }

  return { populate };
}

export function createTimeWindowRefresh({ notify, hydrate }) {
  return function refreshTimeWindow() {
    notify();
    return hydrate({ preserveSelection: true, notify: false });
  };
}
