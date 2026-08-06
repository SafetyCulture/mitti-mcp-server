import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classifyTool } from './read-only.js';

const allows = (tool: unknown) => classifyTool(tool).readOnly;

test('allows only tools declaring readOnlyHint: true', () => {
  assert.equal(allows({ name: 'sites_get', annotations: { readOnlyHint: true } }), true);
  assert.equal(allows({ name: 'sites_create', annotations: { readOnlyHint: false } }), false);
});

test('blocks tools with no annotations, whatever the name suggests', () => {
  // Real unannotated tools from the live server — read-looking names, unproven.
  assert.equal(allows({ name: 'sensors_get_latest_reading' }), false);
  assert.equal(allows({ name: 'utils_calculate_date_difference' }), false);
  assert.equal(allows({ name: 'escalations_get_plan' }), false);
  assert.equal(allows({ name: 'sites_get', annotations: {} }), false);
});

test('contradictory annotations resolve to blocked', () => {
  assert.equal(allows({ name: 'x_get', annotations: { readOnlyHint: true, destructiveHint: true } }), false);
});

test('non-boolean readOnlyHint is not trusted', () => {
  assert.equal(allows({ name: 'x_get', annotations: { readOnlyHint: 'true' } }), false);
  assert.equal(allows({ name: 'x_get', annotations: { readOnlyHint: 1 } }), false);
  assert.equal(allows({ name: 'x_get', annotations: { readOnlyHint: null } }), false);
});

test('blocks malformed tools', () => {
  assert.equal(allows({}), false);
  assert.equal(allows(null), false);
  assert.equal(allows(undefined), false);
  assert.equal(allows({ name: '', annotations: { readOnlyHint: true } }), false);
});

test('reasons explain why a tool was blocked', () => {
  assert.match(classifyTool({ name: 'a_get' }).reason, /no annotations/);
  assert.match(classifyTool({ name: 'a_get', annotations: {} }).reason, /no readOnlyHint/);
  assert.match(
    classifyTool({ name: 'a_get', annotations: { readOnlyHint: false } }).reason,
    /readOnlyHint is false/,
  );
});
