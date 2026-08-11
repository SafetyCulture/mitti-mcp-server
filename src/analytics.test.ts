import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { MockAmplitudeMCPAnalytics } from '@amplitude/mcp-analytics/testing';
import { createToolCallTracker, createToolUsageTracker, NOOP_TRACKER } from './analytics.js';

const IDENTITY = { userId: 'user_d8d0b3ecb34a482ead73e963b3a4e7e2', orgId: 'org_123' };

function setup(identity: { userId: string; orgId?: string } = IDENTITY) {
  const mock = new MockAmplitudeMCPAnalytics({ serverName: 'mitti-mcp', serverVersion: '0.2.0' });
  const logged: string[] = [];
  const tracker = createToolCallTracker(mock, {
    identity,
    serverVersion: '0.2.0',
    log: (message) => logged.push(message),
  });
  return { mock, tracker, logged };
}

test('a tracked call becomes one [MCP] Tool Call Response event attributed to the user and org', () => {
  const { mock, tracker } = setup();

  tracker.track({ toolName: 'sites_get', durationMs: 42.4, isError: false });

  const events = mock.getEvents('[MCP] Tool Call Response');
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.user_id, IDENTITY.userId);
  assert.deepEqual(event.groups, { 'org id': IDENTITY.orgId });
  assert.equal(event.event_properties?.['[MCP] Tool Name'], 'sites_get');
  assert.equal(event.event_properties?.['[MCP] Is Error'], false);
  assert.equal(event.event_properties?.['[MCP] Response Duration'], 42, 'rounded to whole milliseconds');
  assert.equal(event.event_properties?.['[MCP] Server Version'], '0.2.0');
});

test('the MCP client is reported once the handshake reveals it', () => {
  const { mock, tracker } = setup();

  tracker.observeClient({ name: 'claude-code', version: '2.1.0' });
  tracker.observeClient({ protocolVersion: '2025-06-18' });
  tracker.track({ toolName: 'sites_get', durationMs: 1, isError: false });

  const [event] = mock.getEvents('[MCP] Tool Call Response');
  assert.equal(event.event_properties?.['[MCP] Client Name'], 'claude-code');
  assert.equal(event.event_properties?.['[MCP] Client Version'], '2.1.0');
  assert.equal(event.event_properties?.['[MCP] Protocol Version'], '2025-06-18');
});

// Each observation carries only the fields that arrived with it, so a merge is
// the difference between knowing the client and forgetting it a moment later.
test('observing the protocol version does not erase the client already learned', () => {
  const { mock, tracker } = setup();

  tracker.observeClient({ name: 'cursor', version: '1.0.0' });
  tracker.observeClient({ protocolVersion: '2025-06-18' });
  tracker.track({ toolName: 'sites_get', durationMs: 1, isError: false });

  const [event] = mock.getEvents('[MCP] Tool Call Response');
  assert.equal(event.event_properties?.['[MCP] Client Name'], 'cursor');
});

test('a failed call is recorded as an error, with the protocol-level message', () => {
  const { mock, tracker } = setup();

  tracker.track({ toolName: 'sites_search', durationMs: 7, isError: true, errorMessage: 'request timed out' });

  const [event] = mock.getEvents('[MCP] Tool Call Response');
  assert.equal(event.event_properties?.['[MCP] Is Error'], true);
  assert.equal(event.event_properties?.['[MCP] Error Message'], 'request timed out');
});

test('an error with no message reports the failure without inventing one', () => {
  const { mock, tracker } = setup();

  tracker.track({ toolName: 'sites_search', durationMs: 7, isError: true });

  const [event] = mock.getEvents('[MCP] Tool Call Response');
  assert.equal(event.event_properties?.['[MCP] Is Error'], true);
  assert.equal(event.event_properties?.['[MCP] Error Message'], undefined);
});

// Group types are a paid Amplitude feature and the org isn't always resolvable.
// Events still have to land, just without the rollup.
test('a missing org still reports the call, just ungrouped', () => {
  const { mock, tracker } = setup({ userId: IDENTITY.userId });

  tracker.track({ toolName: 'sites_get', durationMs: 1, isError: false });

  const events = mock.getEvents('[MCP] Tool Call Response');
  assert.equal(events.length, 1);
  assert.equal(events[0].user_id, IDENTITY.userId);
});

test('no API key means no analytics client, and every call is inert', async () => {
  const tracker = createToolUsageTracker({
    apiKey: undefined,
    identity: IDENTITY,
    serverVersion: '0.2.0',
    log: () => {},
  });

  assert.equal(tracker, NOOP_TRACKER);
  // Must not throw, hit the network, or need a key.
  tracker.observeClient({ name: 'claude-code' });
  tracker.track({ toolName: 'sites_get', durationMs: 1, isError: false });
  await tracker.shutdown();
});

// The whole point of the try/catch in track(): a broken analytics client is a
// silent non-event for the proxy, never an exception thrown back into the relay.
test('an analytics client that throws is logged, not propagated', () => {
  const logged: string[] = [];
  const exploding = {
    trackToolEvent() {
      throw new Error('amplitude exploded');
    },
    flush() {},
    shutdown() {},
  } as unknown as MockAmplitudeMCPAnalytics;

  const tracker = createToolCallTracker(exploding, {
    identity: IDENTITY,
    serverVersion: '0.2.0',
    log: (message) => logged.push(message),
  });

  tracker.track({ toolName: 'sites_get', durationMs: 1, isError: false });
  assert.equal(logged.length, 1);
  assert.match(logged[0], /amplitude exploded/);
});

test('a failing flush on shutdown is logged, not thrown', async () => {
  const logged: string[] = [];
  const exploding = {
    trackToolEvent() {},
    flush() {
      throw new Error('flush exploded');
    },
    shutdown() {},
  } as unknown as MockAmplitudeMCPAnalytics;

  const tracker = createToolCallTracker(exploding, {
    identity: IDENTITY,
    serverVersion: '0.2.0',
    log: (message) => logged.push(message),
  });

  await tracker.shutdown();
  assert.match(logged[0], /flush exploded/);
});
