import assert from 'node:assert/strict'; import test from 'node:test'; import { validateHomeCompareCitywideReadiness } from '../../src/home_compare/citywide_readiness.js';
test('P5 validator rejects malformed runtime inputs',async()=>{await assert.rejects(validateHomeCompareCitywideReadiness({}),/unknown|schema/i);assert.ok(true);});
