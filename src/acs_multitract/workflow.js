import {
  aggregateAcsTractPopulation,
  fetchAcsPopulationVreSnapshot,
  reviewAcsTractSelections,
  toAcsAggregationEvidenceRecord,
} from '../acs_aggregation.js';
import { parseAcsTractSelectionText } from './selection.js';
import { adaptAcsVreSourceHealthObservation } from './source_health.js';

/** Product workflow with an explicit Review gate before source access or calculation. */
export function createAcsMultitractWorkflow({
  loadSnapshot = fetchAcsPopulationVreSnapshot,
  onSourceHealthObservation = () => {},
  onEvidenceRecord = () => {},
} = {}) {
  let generation = 0;
  let reviewed = null;
  let outcome = null;
  let activeReview = null;

  function state() {
    return Object.freeze({ reviewed, outcome });
  }

  function invalidate() {
    generation += 1;
    activeReview?.abort();
    activeReview = null;
    reviewed = null;
    outcome = null;
    return state();
  }

  async function review(selectionText) {
    const requestGeneration = ++generation;
    activeReview?.abort();
    activeReview = null;
    reviewed = null;
    outcome = null;
    const parsed = parseAcsTractSelectionText(selectionText);
    if (parsed.status !== 'available') {
      reviewed = parsed;
      return parsed;
    }

    const controller = new AbortController();
    activeReview = controller;
    let source;
    try {
      source = await loadSnapshot({ signal: controller.signal });
    } catch {
      source = { status: 'unavailable', snapshot: null };
    }
    if (requestGeneration !== generation) return { status: 'superseded' };
    activeReview = null;

    const observation = adaptAcsVreSourceHealthObservation(source);
    try { onSourceHealthObservation(observation); } catch {}
    reviewed = source?.status === 'available'
      ? reviewAcsTractSelections({ selections: parsed.selections, snapshot: source.snapshot })
      : { status: 'unavailable', reason: 'vre-source-unavailable', result: null };
    return reviewed;
  }

  function calculate() {
    if (reviewed?.status !== 'available') return null;
    outcome = aggregateAcsTractPopulation({
      selections: reviewed.review.selections,
      snapshot: reviewed.review.snapshot,
    });
    const evidenceRecord = toAcsAggregationEvidenceRecord(outcome);
    if (evidenceRecord) {
      try { onEvidenceRecord(evidenceRecord); } catch {}
    }
    return outcome;
  }

  return Object.freeze({ calculate, getState: state, invalidate, review });
}
