import { strict as assert } from 'node:assert';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { getCachedSeat, setCachedSeat } from './seat-cache.js';

const root = mkdtempSync(join(tmpdir(), 'sc-mcp-cache-'));
process.env.SC_MCP_CACHE_DIR = root;

const cacheFile = join(root, 'sc-mcp', 'seats.json');
const DAY = 24 * 60 * 60 * 1000;

let n = 0;
const tok = () => `token-${++n}`;

afterEach(() => {
  process.env.SC_MCP_CACHE_DIR = root;
});

test('round-trips a seat type', () => {
  const token = tok();
  assert.equal(getCachedSeat(token), undefined);
  setCachedSeat(token, { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  assert.equal(getCachedSeat(token)?.seatType, 'SUBSCRIPTION_SEAT_TYPE_PREMIUM');
});

test('creates the directory tree it needs', () => {
  setCachedSeat(tok(), { seatType: 'SUBSCRIPTION_SEAT_TYPE_LITE' });
  assert.ok(existsSync(cacheFile), 'cache file should exist');
});

test('never writes the token itself — only its hash', () => {
  const token = 'scapi_super_secret_value';
  setCachedSeat(token, { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  const raw = readdirSync(join(root, 'sc-mcp'))
    .map((f) => readFileSync(join(root, 'sc-mcp', f), 'utf8'))
    .join('');
  assert.equal(raw.includes(token), false, 'cache must not contain the raw token');
  assert.equal(raw.includes('super_secret'), false);
});

test('leaves no temp files behind', () => {
  setCachedSeat(tok(), { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  const strays = readdirSync(join(root, 'sc-mcp')).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(strays, []);
});

test('expires entries older than the TTL', () => {
  const token = tok();
  const now = Date.now();
  setCachedSeat(token, { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' }, now - DAY - 1000);
  assert.equal(getCachedSeat(token, now), undefined, 'stale entry should miss');

  setCachedSeat(token, { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' }, now);
  assert.equal(getCachedSeat(token, now)?.seatType, 'SUBSCRIPTION_SEAT_TYPE_PREMIUM');
});

test('prunes expired entries on write so the file cannot grow forever', () => {
  const stale = tok();
  const now = Date.now();
  setCachedSeat(stale, { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' }, now - DAY - 1000);
  setCachedSeat(tok(), { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' }, now);
  assert.equal(getCachedSeat(stale, now), undefined);
});

test('a corrupt cache file is treated as empty, not fatal', () => {
  const token = tok();
  setCachedSeat(token, { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  writeFileSync(cacheFile, '{ this is not json');

  assert.equal(getCachedSeat(token), undefined);
  // And it recovers on the next write.
  setCachedSeat(token, { seatType: 'SUBSCRIPTION_SEAT_TYPE_LITE' });
  assert.equal(getCachedSeat(token)?.seatType, 'SUBSCRIPTION_SEAT_TYPE_LITE');
});

test('an unwritable cache dir does not throw', () => {
  process.env.SC_MCP_CACHE_DIR = '/proc/nonexistent-sc-mcp-path';
  assert.doesNotThrow(() => setCachedSeat(tok(), { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' }));
});

test('honours SC_MCP_CACHE_DIR over platform defaults', () => {
  const alt = mkdtempSync(join(tmpdir(), 'sc-mcp-alt-'));
  process.env.SC_MCP_CACHE_DIR = alt;
  setCachedSeat('t', { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
  assert.ok(existsSync(join(alt, 'sc-mcp', 'seats.json')));
});

// POSIX-only: Windows ignores all but the read-only bit, which is why the cache
// key is a hash rather than the token.
test(
  'file is written 0600 on POSIX',
  { skip: process.platform === 'win32' ? 'POSIX only' : false },
  () => {
    setCachedSeat(tok(), { seatType: 'SUBSCRIPTION_SEAT_TYPE_PREMIUM' });
    assert.equal(statSync(cacheFile).mode & 0o777, 0o600);
  }
);
