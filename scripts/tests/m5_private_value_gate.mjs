import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M5_PRIVATE_SENTINELS,
  assertNoPrivateSentinels,
} from './support/m5_private_value_gate.mjs';

test('full gate rejects hostile Diary-seed logs that the old late slice missed', () => {
  for (const [sentinelIndex, sentinel] of M5_PRIVATE_SENTINELS.entries()) {
    const consoleMessages = ['ordinary seed message', `hostile:${sentinel}`];
    const oldLateCheckpoint = consoleMessages.length;
    assert.deepEqual(
      consoleMessages.slice(oldLateCheckpoint),
      [],
      'the superseded late-slice check reproduces the reviewed false negative',
    );
    let failure;
    try {
      assertNoPrivateSentinels(consoleMessages, 'seed-console-messages');
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, `sentinel index ${sentinelIndex} must fail the gate`);
    assert.equal(failure.code, 'M5_PRIVATE_SENTINEL_DETECTED');
    assert.equal(failure.category, 'seed-console-messages');
    assert.equal(failure.sentinelIndex, sentinelIndex);
    assert.match(failure.message, new RegExp(`sentinel-index=${sentinelIndex}$`));
    assert.equal(failure.message.includes(sentinel), false, 'failure message must redact the sentinel');
  }
});

test('non-private observations pass the same executable gate', () => {
  assert.doesNotThrow(() => assertNoPrivateSentinels(
    ['ordinary seed message', { url: 'http://127.0.0.1:4195/' }],
    'seed-console-messages',
  ));
});
