import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createAmplitudeHttpClient } from './amplitude.js';

const URL_UNDER_TEST = 'https://amplitude.example.test/2/httpapi';

/** A fetch double that records every request body it's handed. */
function stubFetch(respond: () => Response = () => new Response('{}', { status: 200 })) {
  const bodies: Array<{ api_key: string; events: Array<Record<string, unknown>> }> = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return respond();
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

function setup(respond?: () => Response) {
  const { bodies, fetchImpl } = stubFetch(respond);
  const logged: string[] = [];
  const client = createAmplitudeHttpClient({
    apiKey: 'amp_key',
    log: (message) => logged.push(message),
    fetchImpl,
    url: URL_UNDER_TEST,
  });
  return { client, bodies, logged };
}

const EVENT = { event_type: '[MCP] Tool Call Response', user_id: 'user_1' };

test('nothing is sent until flush', async () => {
  const { client, bodies } = setup();

  client.track(EVENT);
  assert.equal(bodies.length, 0);

  await client.flush();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].api_key, 'amp_key');
  assert.equal(bodies[0].events.length, 1);
  assert.equal(bodies[0].events[0].event_type, '[MCP] Tool Call Response');
});

// Events are flushed when the proxy exits, so without a timestamp of their own
// Amplitude would date every call to the moment the session ended.
test('each event carries the time it happened and a dedup id', async () => {
  const { client, bodies } = setup();

  client.track(EVENT);
  await client.flush();

  const [event] = bodies[0].events;
  assert.equal(typeof event.time, 'number');
  assert.ok(Math.abs((event.time as number) - Date.now()) < 5000);
  assert.match(String(event.insert_id), /^[0-9a-f-]{36}$/);
});

test('flush sends one batch and empties the queue', async () => {
  const { client, bodies } = setup();

  client.track(EVENT);
  client.track(EVENT);
  await client.flush();
  await client.flush();

  assert.equal(bodies.length, 1, 'the second flush had nothing left to send');
  assert.equal(bodies[0].events.length, 2);
});

// A long session must not accumulate events in memory until exit.
test('a full queue is sent without waiting for flush', async () => {
  const { client, bodies } = setup();

  for (let i = 0; i < 20; i++) client.track(EVENT);
  await client.flush();

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].events.length, 20);
});

test('a rejected batch is logged and dropped, not retried', async () => {
  const { client, bodies, logged } = setup(() => new Response('bad request', { status: 400 }));

  client.track(EVENT);
  await client.flush();

  assert.equal(bodies.length, 1, 'sent once');
  assert.match(logged[0], /rejected with 400/);
});

test('a network failure is logged, and flush still resolves', async () => {
  const failing = (async () => {
    throw new Error('connection refused');
  }) as unknown as typeof fetch;
  const logged: string[] = [];
  const client = createAmplitudeHttpClient({
    apiKey: 'amp_key',
    log: (message) => logged.push(message),
    fetchImpl: failing,
    url: URL_UNDER_TEST,
  });

  client.track(EVENT);
  await client.flush();

  assert.match(logged[0], /not delivered — connection refused/);
});

test('flush waits for a send already in flight', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bodies: unknown[] = [];
  const slow = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    await gate;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  const client = createAmplitudeHttpClient({
    apiKey: 'amp_key',
    log: () => {},
    fetchImpl: slow,
    url: URL_UNDER_TEST,
  });

  // Fills the queue, which dispatches immediately and blocks on the gate.
  for (let i = 0; i < 20; i++) client.track(EVENT);
  let flushed = false;
  const flushing = client.flush().then(() => {
    flushed = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(flushed, false, 'flush should still be waiting on the in-flight send');

  release?.();
  await flushing;
  assert.equal(flushed, true);
});

test('after shutdown, further events are ignored', async () => {
  const { client, bodies } = setup();

  client.shutdown();
  client.track(EVENT);
  await client.flush();

  assert.equal(bodies.length, 0);
});

// The MCP SDK routes its own warnings through this, and the default would be
// console.log — which is the MCP transport in this process.
test('a logger is exposed for the SDK, and it never writes to stdout', () => {
  const { client, logged } = setup();

  client.configuration.loggerProvider.warn('something odd');
  client.configuration.loggerProvider.error('something broken');
  client.configuration.loggerProvider.debug('noise');
  client.configuration.loggerProvider.info('noise');

  assert.deepEqual(logged, ['analytics warn: something odd', 'analytics error: something broken']);
});
