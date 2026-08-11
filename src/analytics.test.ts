import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createToolUsageTracker, NOOP_TRACKER } from './analytics.js';

const URL_UNDER_TEST = 'https://amplitude.example.test/2/httpapi';
const IDENTITY = { userId: 'user_d8d0b3ecb34a482ead73e963b3a4e7e2', orgId: 'role_ae9b2d51' };
const OUTCOME = { toolName: 'sites_get', durationMs: 42.4, isError: false };

interface SentEvent {
  event_type: string;
  user_id: string;
  groups?: Record<string, string>;
  time: number;
  insert_id: string;
  event_properties: Record<string, unknown>;
}

/** A fetch double that records the events it's asked to deliver. */
function stubFetch(respond: () => Response = () => new Response('{}', { status: 200 })) {
  const sent: Array<{ api_key: string; events: SentEvent[] }> = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return respond();
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

function setup(opts: { identity?: typeof IDENTITY | { userId: string }; respond?: () => Response } = {}) {
  const { sent, fetchImpl } = stubFetch(opts.respond);
  const logged: string[] = [];
  const tracker = createToolUsageTracker({
    apiKey: 'amp_key',
    identity: opts.identity ?? IDENTITY,
    serverVersion: '0.3.2',
    log: (message) => logged.push(message),
    fetchImpl,
    url: URL_UNDER_TEST,
  });
  return { tracker, sent, logged };
}

// No queue, so an event that happened is an event already on its way. A released
// build once held them until exit, and a session that lives as long as the editor
// never reached exit.
test('a tracked call is posted as it happens, with no shutdown', async () => {
  const { tracker, sent } = setup();

  tracker.track(OUTCOME);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].api_key, 'amp_key');
  assert.equal(sent[0].events.length, 1);
});

test('the event carries the identity, tool, outcome and versions', async () => {
  const { tracker, sent } = setup();

  tracker.observeClient({ name: 'claude-code', version: '2.1.0' });
  tracker.track(OUTCOME);
  await tracker.shutdown();

  const [event] = sent[0].events;
  assert.equal(event.event_type, '[MCP] Tool Call Response');
  assert.equal(event.user_id, IDENTITY.userId);
  assert.deepEqual(event.groups, { 'org id': IDENTITY.orgId });
  assert.equal(typeof event.time, 'number');
  assert.match(event.insert_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(event.event_properties, {
    '[MCP] Server Name': 'mitti-mcp',
    '[MCP] Server Version': '0.3.2',
    '[MCP] Transport': 'stdio',
    '[MCP] Tool Name': 'sites_get',
    '[MCP] Is Error': false,
    '[MCP] Response Duration': 42, // rounded
    '[MCP] Client Name': 'claude-code',
    '[MCP] Client Version': '2.1.0',
  });
});

// The property list above is the whole payload. This pins the promise the README
// makes: nothing about what a tool was asked or what it answered.
test('no tool arguments or results can reach the wire', async () => {
  const { tracker, sent } = setup();

  tracker.track({ ...OUTCOME, isError: true, errorMessage: 'request timed out' });
  await tracker.shutdown();

  const body = JSON.stringify(sent[0]);
  assert.ok(!body.includes('arguments'));
  assert.ok(!body.includes('content'));
  assert.ok(body.includes('amp_key'), 'the api key is the one credential that belongs in the payload');
});

test('an unidentified client is simply absent, and the event still goes', async () => {
  const { tracker, sent } = setup();

  tracker.track(OUTCOME);
  await tracker.shutdown();

  const { event_properties: props } = sent[0].events[0];
  assert.equal('[MCP] Client Name' in props, false);
  assert.equal('[MCP] Client Version' in props, false);
  assert.equal(props['[MCP] Tool Name'], 'sites_get');
});

// Group types are a paid Amplitude feature and the org isn't always resolvable.
test('a missing org still reports the call, just ungrouped', async () => {
  const { tracker, sent } = setup({ identity: { userId: IDENTITY.userId } });

  tracker.track(OUTCOME);
  await tracker.shutdown();

  assert.equal(sent[0].events[0].groups, undefined);
  assert.equal(sent[0].events[0].user_id, IDENTITY.userId);
});

test('a failure records the protocol-level message', async () => {
  const { tracker, sent } = setup();

  tracker.track({ toolName: 'sites_search', durationMs: 7, isError: true, errorMessage: 'upstream unavailable' });
  await tracker.shutdown();

  const { event_properties: props } = sent[0].events[0];
  assert.equal(props['[MCP] Is Error'], true);
  assert.equal(props['[MCP] Error Message'], 'upstream unavailable');
});

test('a failure with no message reports it without inventing one', async () => {
  const { tracker, sent } = setup();

  tracker.track({ toolName: 'sites_search', durationMs: 7, isError: true });
  await tracker.shutdown();

  const { event_properties: props } = sent[0].events[0];
  assert.equal(props['[MCP] Is Error'], true);
  assert.equal('[MCP] Error Message' in props, false);
});

// Silence used to mean either "delivered" or "never attempted", which is not a
// distinction a log should leave to guesswork.
test('the first accepted event is confirmed in the log, and only once', async () => {
  const { tracker, logged } = setup();

  tracker.track(OUTCOME);
  await tracker.shutdown();
  assert.deepEqual(logged, ['analytics: delivery confirmed']);

  tracker.track(OUTCOME);
  tracker.track(OUTCOME);
  await tracker.shutdown();
  assert.equal(logged.length, 1, 'not repeated for every event');
});

test('a rejected event is not reported as confirmed', async () => {
  const { tracker, logged } = setup({ respond: () => new Response('nope', { status: 400 }) });

  tracker.track(OUTCOME);
  await tracker.shutdown();

  assert.equal(logged.some((m) => m.includes('confirmed')), false);
});

test('each call is its own request', async () => {
  const { tracker, sent } = setup();

  tracker.track(OUTCOME);
  tracker.track(OUTCOME);
  tracker.track(OUTCOME);
  await tracker.shutdown();

  assert.equal(sent.length, 3);
});

// shutdown() runs immediately before process.exit(), so anything it fails to wait
// for is an event killed in transit.
test('shutdown waits for a send already in flight', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tracker = createToolUsageTracker({
    apiKey: 'amp_key',
    identity: IDENTITY,
    serverVersion: '0.3.2',
    log: () => {},
    fetchImpl: (async () => {
      await gate;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch,
    url: URL_UNDER_TEST,
  });

  tracker.track(OUTCOME);
  let done = false;
  const shutting = tracker.shutdown().then(() => {
    done = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false, 'shutdown should still be waiting');

  release?.();
  await shutting;
  assert.equal(done, true);
});

// A tool response can land in the same tick as the shutdown that drains.
test('shutdown also waits for a send that starts while it is waiting', async () => {
  let started = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tracker = createToolUsageTracker({
    apiKey: 'amp_key',
    identity: IDENTITY,
    serverVersion: '0.3.2',
    log: () => {},
    fetchImpl: (async () => {
      started += 1;
      if (started === 1) await gate;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch,
    url: URL_UNDER_TEST,
  });

  tracker.track(OUTCOME);
  const shutting = tracker.shutdown();
  tracker.track(OUTCOME);
  release?.();
  await shutting;

  assert.equal(started, 2, 'both sends completed before shutdown resolved');
});

test('a rejected event is logged and dropped, not retried', async () => {
  const { tracker, sent, logged } = setup({ respond: () => new Response('nope', { status: 400 }) });

  tracker.track(OUTCOME);
  await tracker.shutdown();

  assert.equal(sent.length, 1, 'sent once');
  assert.match(logged[0], /rejected with 400/);
});

test('a network failure is logged, and shutdown still resolves', async () => {
  const logged: string[] = [];
  const tracker = createToolUsageTracker({
    apiKey: 'amp_key',
    identity: IDENTITY,
    serverVersion: '0.3.2',
    log: (message) => logged.push(message),
    fetchImpl: (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch,
    url: URL_UNDER_TEST,
  });

  tracker.track(OUTCOME);
  await tracker.shutdown();

  assert.match(logged[0], /not delivered — connection refused/);
});

test('no key means no analytics client, and every call is inert', async () => {
  let called = false;
  const tracker = createToolUsageTracker({
    apiKey: undefined,
    identity: IDENTITY,
    serverVersion: '0.3.2',
    log: () => {},
    fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch,
  });

  assert.equal(tracker, NOOP_TRACKER);
  tracker.observeClient({ name: 'claude-code' });
  tracker.track(OUTCOME);
  await tracker.shutdown();
  assert.equal(called, false, 'nothing should reach the network');
});
