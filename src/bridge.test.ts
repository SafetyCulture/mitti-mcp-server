import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createBridge } from './bridge.js';
import type { BridgeTransport } from './bridge.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/** A transport double that records what it's sent and lets tests drive `onmessage` directly. */
function fakeTransport(): BridgeTransport & { sent: JSONRPCMessage[] } {
  const sent: JSONRPCMessage[] = [];
  return {
    sent,
    onmessage: undefined,
    async send(message) {
      sent.push(message);
    },
  };
}

/** Feed a raw message into a transport's onmessage — deliberately untyped, since several
 * fixtures below are malformed on purpose and shouldn't be forced to satisfy JSONRPCMessage. */
function receive(transport: BridgeTransport, message: unknown): void {
  transport.onmessage?.(message as JSONRPCMessage);
}

const READ_ONLY_TOOL = { name: 'sites_get', annotations: { readOnlyHint: true } };
const WRITE_TOOL = { name: 'sites_create', annotations: { readOnlyHint: false } };

function setup() {
  const local = fakeTransport();
  const remote = fakeTransport();
  createBridge(local, remote, () => {});
  return { local, remote };
}

/** Drive a tools/list round-trip so `sites_get` is known read-only and `sites_create` is not. */
function primeToolsList(local: BridgeTransport, remote: BridgeTransport & { sent: JSONRPCMessage[] }) {
  receive(local, { jsonrpc: '2.0', id: 'list-1', method: 'tools/list' });
  receive(remote, {
    jsonrpc: '2.0',
    id: 'list-1',
    result: { tools: [READ_ONLY_TOOL, WRITE_TOOL] },
  });
}

test('an id-less tools/call is dropped and never reaches the remote transport', () => {
  const { local, remote } = setup();
  receive(local, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'inspections_delete', arguments: {} },
  });
  assert.equal(remote.sent.length, 0);
});

test('a request with an unrecognised method is dropped, not forwarded', () => {
  const { local, remote } = setup();
  receive(local, { jsonrpc: '2.0', id: 1, method: 'completion/complete', params: {} });

  assert.equal(remote.sent.length, 0);
  assert.equal(local.sent.length, 1);
  const response = local.sent[0] as { id: unknown; error?: { code: number } };
  assert.equal(response.id, 1);
  assert.equal(response.error?.code, -32601); // MethodNotFound
});

test('a tools/call for a name proven read-only via a prior tools/list passes through', () => {
  const { local, remote } = setup();
  primeToolsList(local, remote);

  receive(local, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'sites_get', arguments: {} } });

  const forwarded = remote.sent.find((m) => (m as { id?: unknown }).id === 2);
  assert.ok(forwarded, 'the tools/call should have been forwarded to the remote transport');
});

test('a tools/call for a name never seen in a tools/list is rejected locally', () => {
  const { local, remote } = setup();
  receive(local, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'never_listed', arguments: {} } });

  assert.equal(remote.sent.length, 0);
  const response = local.sent.find((m) => (m as { id?: unknown }).id === 3) as { error?: { code: number } };
  assert.ok(response, 'a local error response should have been sent');
  assert.equal(response.error?.code, -32602); // InvalidParams
});

test('a tools/call for a name proven non-read-only is rejected locally', () => {
  const { local, remote } = setup();
  primeToolsList(local, remote);

  receive(local, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'sites_create', arguments: {} } });

  assert.ok(!remote.sent.some((m) => (m as { id?: unknown }).id === 4));
  const response = local.sent.find((m) => (m as { id?: unknown }).id === 4) as { error?: { code: number } };
  assert.ok(response);
  assert.equal(response.error?.code, -32602);
});

test('a tools/call with a non-string name is rejected locally, not forwarded', () => {
  const { local, remote } = setup();
  receive(local, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 123, arguments: {} } });

  assert.equal(remote.sent.length, 0);
  const response = local.sent.find((m) => (m as { id?: unknown }).id === 5) as { error?: { code: number } };
  assert.ok(response);
  assert.equal(response.error?.code, -32602);
});

test('tools/list responses are filtered and the verdicts map is populated correctly', () => {
  const { local, remote } = setup();
  primeToolsList(local, remote);

  const filtered = local.sent.find((m) => (m as { id?: unknown }).id === 'list-1') as unknown as {
    result: { tools: Array<{ name: string }> };
  };
  assert.ok(filtered);
  assert.deepEqual(
    filtered.result.tools.map((t) => t.name),
    ['sites_get']
  );

  // The verdicts learned above now gate tools/call: sites_get passes, sites_create doesn't.
  receive(local, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'sites_get', arguments: {} } });
  receive(local, { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'sites_create', arguments: {} } });

  assert.ok(remote.sent.some((m) => (m as { id?: unknown }).id === 10));
  assert.ok(!remote.sent.some((m) => (m as { id?: unknown }).id === 11));
});

test('an unrecognised notification is dropped', () => {
  const { local, remote } = setup();
  receive(local, { jsonrpc: '2.0', method: 'notifications/made_up' });
  assert.equal(remote.sent.length, 0);
});

test('a recognised notification is forwarded', () => {
  const { local, remote } = setup();
  receive(local, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(remote.sent.length, 1);
});

test('a recognised read method is forwarded', () => {
  const { local, remote } = setup();
  receive(local, { jsonrpc: '2.0', id: 20, method: 'resources/read', params: { uri: 'mitti://x' } });
  assert.ok(remote.sent.some((m) => (m as { id?: unknown }).id === 20));
});
