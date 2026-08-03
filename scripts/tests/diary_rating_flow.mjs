#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ratingFlow = await import('../../src/routes_diary/rating_flow.js').catch(() => ({}));
const formSubmit = await import('../../src/routes_diary/form_submit.js').catch(() => ({}));

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test('a new route draft requires an explicit overall rating and restores only its route', () => {
  assert.equal(typeof ratingFlow.createRatingDraft, 'function');
  assert.equal(typeof ratingFlow.saveRatingDraft, 'function');
  assert.equal(typeof ratingFlow.getRatingDraft, 'function');

  const draft = ratingFlow.createRatingDraft('route-a');
  assert.equal(draft.step, 'overall');
  assert.equal(draft.overallRating, null);

  draft.overallRating = 4;
  draft.step = 'details';
  ratingFlow.saveRatingDraft('route-a', draft);

  assert.deepEqual(ratingFlow.getRatingDraft('route-a'), {
    step: 'details',
    overallRating: 4,
    tags: [],
    notes: '',
    overrides: [],
  });
  assert.equal(ratingFlow.getRatingDraft('route-b'), null);
});

test('successful completion clears the saved route draft', () => {
  ratingFlow.saveRatingDraft('route-clear', {
    step: 'segments',
    overallRating: 2,
    tags: ['poor_lighting'],
    notes: 'Dark corner',
    overrides: [['segment-1', 1]],
  });

  ratingFlow.clearRatingDraft('route-clear');

  assert.equal(ratingFlow.getRatingDraft('route-clear'), null);
});

test('only the three lowest-rated route segments are offered', () => {
  const segmentIds = Array.from({ length: 48 }, (_, index) => `segment-${index + 1}`);
  const lookup = new Map(segmentIds.map((segmentId, index) => [segmentId, {
    properties: { segment_id: segmentId, decayed_mean: 48 - index },
  }]));

  const visible = ratingFlow.selectLowestRatedSegments({
    properties: { segment_ids: segmentIds },
  }, lookup);

  assert.deepEqual(visible.map(({ segmentId }) => segmentId), ['segment-48', 'segment-47', 'segment-46']);
  assert.equal(visible.length, 3);
});

test('segment overrides are optional and capped at two', () => {
  const overrides = new Map();
  assert.equal(ratingFlow.setSegmentOverride(overrides, 'segment-1', 2).ok, true);
  assert.equal(ratingFlow.setSegmentOverride(overrides, 'segment-2', 3).ok, true);
  assert.deepEqual(ratingFlow.setSegmentOverride(overrides, 'segment-3', 1), {
    ok: false,
    error: 'Only two segment overrides are supported.',
  });
  assert.equal(overrides.size, 2);
});

test('step validation allows saving from Details but still enforces one to three tags', () => {
  assert.equal(ratingFlow.validateRatingStep({ step: 'overall', overallRating: null }).error, 'Select an overall rating.');
  assert.equal(ratingFlow.validateRatingStep({ step: 'overall', overallRating: 5 }).ok, true);
  assert.equal(ratingFlow.validateRatingStep({ step: 'details', tags: new Set() }).error, 'Pick at least one tag.');
  assert.equal(ratingFlow.validateRatingStep({ step: 'details', tags: new Set(['a', 'b', 'c']) }).ok, true);
  assert.equal(ratingFlow.validateRatingStep({ step: 'details', tags: new Set(['a', 'b', 'c', 'd']) }).error, 'Select at most three tags.');
});

test('rating modal source keeps the accessibility and responsive layout contracts', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../../src/routes_diary/form_submit.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /role', 'dialog'/);
  assert.match(source, /aria-modal', 'true'/);
  assert.match(source, /aria-labelledby'/);
  assert.match(source, /rating\.step/);
  assert.match(source, /backdrop\.appendChild\(modal\)/);
  assert.doesNotMatch(source, /document\.body\.appendChild\(modal\)/);
  assert.doesNotMatch(source, /injectModalStyles|document\.createElement\(['"]style['"]\)/);
  assert.match(css, /\.diary-modal-footer\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.diary-modal-(?:close|footer button)[^{]*\{[^}]*min-(?:width|height):\s*48px/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.diary-modal-card\s*\{[^}]*width:\s*100vw[^}]*height:\s*100dvh/s);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('rating modal manages focus, background inertness, and radio semantics', async () => {
  const source = await readFile(new URL('../../src/routes_diary/form_submit.js', import.meta.url), 'utf8');

  assert.match(source, /activeOpener\s*=\s*document\.activeElement/);
  assert.match(source, /setBackgroundInert\(backdrop\)/);
  assert.match(source, /restoreBackgroundInert\(\)/);
  assert.match(source, /opener\?\.focus\?\.\(\)/);
  assert.match(source, /event\.key\s*===\s*'Tab'/);
  assert.match(source, /event\.shiftKey/);
  assert.match(source, /focusable\[focusable\.length - 1\]\.focus\(\)/);
  assert.match(source, /focusable\[0\]\.focus\(\)/);
  assert.match(source, /row\.setAttribute\('role', 'radiogroup'\)/);
  assert.match(source, /star\.setAttribute\('role', 'radio'\)/);
  assert.match(source, /star\.setAttribute\('aria-checked', String\(rating === state\.overallRating\)\)/);
  assert.match(source, /star\.classList\.toggle\('is-filled', rating <= \(state\.overallRating \|\| 0\)\)/);
  assert.match(source, /\['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'\]/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /selectStarRating\(state, nextRating\)/);
  assert.match(source, /renderCurrentStep\(\{ type: 'star', value: String\(rating\) \}\)/);
  assert.match(source, /renderCurrentStep\(\{ type: 'tag', value: tag \}\)/);
  assert.match(source, /renderCurrentStep\(\{ type: 'segment', value: segmentId \}\)/);
  assert.match(source, /renderCurrentStep\(\{ type: 'step', value: step \}\)/);
  assert.match(source, /restoreRerenderFocus\(focusTarget\)/);
  assert.match(source, /state\.pending/);
  assert.match(source, /submitBtn\.disabled = state\.pending/);
  assert.match(source, /if \(!state \|\| state\.pending \|\| state\.signal\?\.aborted\) return/);
});

test('rating submission remains single-flight while locale rerenders', async () => {
  assert.equal(typeof formSubmit.runRatingSubmission, 'function');
  const gate = deferred();
  const calls = [];
  const state = { pending: false, signal: new AbortController().signal };
  const options = {
    state,
    payload: { route_id: 'route-1' },
    submit: async (payload) => {
      calls.push(payload);
      await gate.promise;
      return { ok: true };
    },
    isCurrent: () => true,
  };

  const first = formSubmit.runRatingSubmission(options);
  assert.equal(state.pending, true);
  const duplicate = await formSubmit.runRatingSubmission(options);
  assert.deepEqual(duplicate, { applied: false, reason: 'pending' });
  assert.equal(calls.length, 1);

  gate.resolve();
  assert.deepEqual(await first, { applied: true, response: { ok: true } });
  assert.equal(state.pending, false);
  assert.equal(calls.length, 1);
});
