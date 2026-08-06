import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';

import { assertNotServiceUser } from './token-guard.js';

const BASE = 'https://api.example.test';
const USER_ID = 'user_d8d0b3ecb34a482ead73e963b3a4e7e2';
const UUID = 'd8d0b3ec-b34a-482e-ad73-e963b3a4e7e2';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub the calls the guard can make, recording the paths it hits. */
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
  assert.equal(await assertNotServiceUser(BASE, 't'), 'SUBSCRIPTION_SEAT_TYPE_PREMIUM');
});

test('allows other human seat types', async () => {
  for (const seat of [
    'SUBSCRIPTION_SEAT_TYPE_LITE',
    'SUBSCRIPTION_SEAT_TYPE_COLLABORATOR',
    'SUBSCRIPTION_SEAT_TYPE_SUPPORT',
  ]) {
    stubApi({ seatType: seat });
    assert.equal(await assertNotServiceUser(BASE, 't'), seat);
  }
});

test('rejects a service user', async () => {
  stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_SERVICE_USER', sessionClass: 'sc_apitoken31' });
  await assert.rejects(() => assertNotServiceUser(BASE, 't'), /service user/);
});

test('rejects a custom agent too — seat type alone decides, no carve-out', async () => {
  stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_SERVICE_USER', sessionClass: 'sc_agent45' });
  await assert.rejects(() => assertNotServiceUser(BASE, 't'), /service user/);
});

test('never exchanges the token — the seat lookup is the whole check', async () => {
  for (const seat of ['SUBSCRIPTION_SEAT_TYPE_PREMIUM', 'SUBSCRIPTION_SEAT_TYPE_SERVICE_USER']) {
    const paths = stubApi({ seatType: seat, sessionClass: 'sc_agent45' });
    await assertNotServiceUser(BASE, 't').catch(() => undefined);
    assert.equal(
      paths.some((p) => p.endsWith('/auth/token')),
      false,
      `${seat} should not trigger a token exchange`
    );
  }
});

test('looks the seat up every time — there is no caching', async () => {
  const first = stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  await assertNotServiceUser(BASE, 'same-token');
  assert.equal(first.length, 2, 'WhoAmI + GetUser');

  const second = stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  await assertNotServiceUser(BASE, 'same-token');
  assert.equal(second.length, 2, 'the same token is looked up again, not remembered');
});

test('rejects when the seat type cannot be established', async () => {
  stubApi({ seatType: undefined });
  await assert.rejects(() => assertNotServiceUser(BASE, 't'), /no seat_type/);

  stubApi({ seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM', getUserStatus: 403 });
  await assert.rejects(() => assertNotServiceUser(BASE, 't'), /returned 403/);

  stubApi({ whoAmIStatus: 401 });
  await assert.rejects(() => assertNotServiceUser(BASE, 't'), /returned 401/);
});

test('rejects a malformed user id rather than guessing', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ user_id: 'not-an-s12-id' }), { status: 200 })) as typeof fetch;
  await assert.rejects(() => assertNotServiceUser(BASE, 't'), /unexpected user id format/);
});
