import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { resolveConfig } from './config.js';

test('requires SC_API_TOKEN', () => {
  assert.throws(() => resolveConfig({}), /SC_API_TOKEN is required/);
  assert.throws(() => resolveConfig({ SC_API_TOKEN: '' }), /SC_API_TOKEN is required/);
});

test('defaults SC_API_URL and derives the MCP endpoint from it', () => {
  const config = resolveConfig({ SC_API_TOKEN: 'scapi_x' });
  assert.equal(config.token, 'scapi_x');
  assert.equal(config.baseUrl, 'https://api.safetyculture.com');
  assert.equal(config.endpoint.href, 'https://api.safetyculture.com/agents/v1/mcp');
});

test('honours a custom SC_API_URL', () => {
  const config = resolveConfig({ SC_API_TOKEN: 'scapi_x', SC_API_URL: 'https://sc.example.test' });
  assert.equal(config.baseUrl, 'https://sc.example.test');
  assert.equal(config.endpoint.href, 'https://sc.example.test/agents/v1/mcp');
});
