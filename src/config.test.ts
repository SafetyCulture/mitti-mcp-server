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

test('honours a custom MITTI_API_URL', () => {
  const config = resolveConfig({
    MITTI_API_TOKEN: 'TOKEN_GOES_HERE',
    MITTI_API_URL: 'https://mitti.example.test',
  });
  assert.equal(config.baseUrl, 'https://mitti.example.test');
  assert.equal(config.endpoint.href, 'https://mitti.example.test/agents/v1/mcp');
});
