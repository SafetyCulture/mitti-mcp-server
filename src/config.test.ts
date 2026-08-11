import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { resolveConfig } from './config.js';

test('requires MITTI_API_TOKEN', () => {
  assert.throws(() => resolveConfig({}), /MITTI_API_TOKEN is required/);
  assert.throws(() => resolveConfig({ MITTI_API_TOKEN: '' }), /MITTI_API_TOKEN is required/);
});

// The rebrand renamed the variable outright — a stale SC_API_TOKEN must not
// quietly keep working, but the error has to name its replacement.
test('rejects the pre-rebrand SC_API_TOKEN, and names what replaced it', () => {
  assert.throws(() => resolveConfig({ SC_API_TOKEN: 'TOKEN_GOES_HERE' }), /renamed to MITTI_API_TOKEN/);
});

test('defaults MITTI_API_URL and derives the MCP endpoint from it', () => {
  const config = resolveConfig({ MITTI_API_TOKEN: 'TOKEN_GOES_HERE' });
  assert.equal(config.token, 'TOKEN_GOES_HERE');
  // Deliberately still safetyculture.com — the rebrand moved no endpoints, and
  // this assertion is what proves it.
  assert.equal(config.baseUrl, 'https://api.safetyculture.com');
  assert.equal(config.endpoint.href, 'https://api.safetyculture.com/agents/v1/mcp');
});

test('analytics reports to the key baked in at release time', () => {
  assert.equal(resolveConfig({ MITTI_API_TOKEN: 'T' }, 'amp_key').analyticsApiKey, 'amp_key');
});

// Builds from source have no key, so running locally reports nothing.
test('with no key baked in, analytics is off', () => {
  assert.equal(resolveConfig({ MITTI_API_TOKEN: 'T' }, undefined).analyticsApiKey, undefined);
});

// The destination is fixed at release time. Whatever launches the proxy holds a
// customer's API token, so it must not also be able to choose where usage data
// goes — there is no environment variable for the key, and this proves it.
test('the environment cannot redirect analytics to another project', () => {
  const config = resolveConfig(
    { MITTI_API_TOKEN: 'T', MITTI_MCP_ANALYTICS_KEY: 'someone_elses_key' },
    'amp_key'
  );
  assert.equal(config.analyticsApiKey, 'amp_key');
});

test('MITTI_MCP_ANALYTICS=off disables analytics', () => {
  for (const value of ['off', 'OFF', 'no', 'false', '0', ' off ']) {
    const config = resolveConfig({ MITTI_API_TOKEN: 'T', MITTI_MCP_ANALYTICS: value }, 'amp_key');
    assert.equal(config.analyticsApiKey, undefined, `${JSON.stringify(value)} should disable analytics`);
  }
});

test('an unrelated MITTI_MCP_ANALYTICS value leaves analytics on', () => {
  const config = resolveConfig({ MITTI_API_TOKEN: 'T', MITTI_MCP_ANALYTICS: 'on' }, 'amp_key');
  assert.equal(config.analyticsApiKey, 'amp_key');
});

test('honours a custom MITTI_API_URL', () => {
  const config = resolveConfig({
    MITTI_API_TOKEN: 'TOKEN_GOES_HERE',
    MITTI_API_URL: 'https://mitti.example.test',
  });
  assert.equal(config.baseUrl, 'https://mitti.example.test');
  assert.equal(config.endpoint.href, 'https://mitti.example.test/agents/v1/mcp');
});
