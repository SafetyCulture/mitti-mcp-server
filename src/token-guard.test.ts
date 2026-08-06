import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { assertNotServiceUser } from './token-guard.js';

// Keep the on-disk seat cache out of the developer's real cache dir.
process.env.SC_MCP_CACHE_DIR = mkdtempSync(join(tmpdir(), 'sc-mcp-test-'));

const BASE = 'https://api.example.test';
const USER_ID = 'user_d8d0b3ecb34a482ead73e963b3a4e7e2';
const UUID = 'd8d0b3ec-b34a-482e-ad73-e963b3a4e7e2';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A distinct token per call, so cached entries never leak between tests. */
let tokenCounter = 0;
const tok = () => `token-${++tokenCounter}`;

/** Stub the three calls the guard can make, recording the paths it hits. */
function stubApi(opts: {
  seatType?: string;
  sessionClass?: string;
  whoAmIStatus?: number;
  getUserStatus?: number;
}) {
  const paths: string[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status });

    if (url.pathname.endsWith('user:WhoAmI')) {
      return json(opts.whoAmIStatus ?? 200, { user_id: USER_ID });
    }
    if (url.pathname.includes('/accounts/GetUser/')) {
      return json(opts.getUserStatus ?? 200, {
        user_document: { id: UUID, seat_type: opts.seatType },
      });
    }
    if (url.pathname.endsWith('/auth/token')) {
      const claims = Buffer.from(JSON.stringify({ cls: opts.sessionClass })).toString('base64url');
      return json(200, { access_token: `header.${claims}.sig` });
    }
    return json(404, {});
  }) as typeof fetch;
  return paths;
}

test('allows a real person and returns their seat type', async () => {
  stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  assert.equal((await assertNotServiceUser(BASE, tok())).seatType, 'SUBSCRIPTION_SEAT_TYPE_PREMIUM');
});

test('allows other human seat types', async () => {
  for (const seat of [
    'SUBSCRIPTION_SEAT_TYPE_LITE',
    'SUBSCRIPTION_SEAT_TYPE_COLLABORATOR',
    'SUBSCRIPTION_SEAT_TYPE_SUPPORT',
  ]) {
    stubApi({ seatType: seat });
    assert.equal((await assertNotServiceUser(BASE, tok())).seatType, seat);
  }
});

test('rejects a service user', async () => {
  stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_SERVICE_USER', sessionClass: 'sc_apitoken31' });
  await assert.rejects(() => assertNotServiceUser(BASE, tok()), /service user/);
});

test('rejects a custom agent too — seat type alone decides, no carve-out', async () => {
  stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_SERVICE_USER', sessionClass: 'sc_agent45' });
  await assert.rejects(() => assertNotServiceUser(BASE, tok()), /service user/);
});

test('never exchanges the token — the seat lookup is the whole check', async () => {
  for (const seat of ['SUBSCRIPTION_SEAT_TYPE_PREMIUM', 'SUBSCRIPTION_SEAT_TYPE_SERVICE_USER']) {
    const paths = stubApi({ seatType: seat, sessionClass: 'sc_agent45' });
    await assertNotServiceUser(BASE, tok()).catch(() => undefined);
    assert.equal(
      paths.some((p) => p.endsWith('/auth/token')),
      false,
      `${seat} should not trigger a token exchange`,
    );
  }
});

test('a second lookup for the same token makes no API calls', async () => {
  const token = tok();
  const first = stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  const cold = await assertNotServiceUser(BASE, token);
  assert.equal(cold.cached, false);
  assert.ok(first.length > 0, 'cold lookup should hit the API');

  const second = stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  const warm = await assertNotServiceUser(BASE, token);
  assert.equal(warm.cached, true);
  assert.equal(warm.seatType, 'SUBSCRIPTION_SEAT_TYPE_PREMIUM');
  assert.deepEqual(second, [], 'warm lookup should hit nothing');
});

test('a rejected service token is cached, so retries cost no API calls', async () => {
  const token = tok();
  stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_SERVICE_USER', sessionClass: 'sc_apitoken31' });
  await assert.rejects(() => assertNotServiceUser(BASE, token), /service user/);

  const retry = stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_SERVICE_USER' });
  await assert.rejects(() => assertNotServiceUser(BASE, token), /service user/);
  assert.deepEqual(retry, [], 'rejection should be served from cache');
});

test('a failed lookup is not cached', async () => {
  const token = tok();
  stubApi({ whoAmIStatus: 401 });
  await assert.rejects(() => assertNotServiceUser(BASE, token), /returned 401/);

  // The token later works — a cached failure would wrongly keep rejecting it.
  stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  assert.equal((await assertNotServiceUser(BASE, token)).seatType, 'SUBSCRIPTION_SEAT_TYPE_PREMIUM');
});

test('rejects when the seat type cannot be established', async () => {
  stubApi({ seatType: undefined });
  await assert.rejects(() => assertNotServiceUser(BASE, tok()), /no seat_type/);

  stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM', getUserStatus: 403 });
  await assert.rejects(() => assertNotServiceUser(BASE, tok()), /returned 403/);

  stubApi({ whoAmIStatus: 401 });
  await assert.rejects(() => assertNotServiceUser(BASE, tok()), /returned 401/);
});
