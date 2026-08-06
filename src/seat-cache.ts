/**
 * On-disk cache of seat lookups, keyed by a hash of the token.
 *
 * sc-mcp is spawned fresh for every client session, so an in-memory cache would
 * never hit — the seat lookup would run on every launch. This persists the
 * result across runs instead.
 *
 * The token is never stored: the key is its SHA-256, so the file is useless to
 * anyone who reads it. It's written 0600 regardless.
 *
 * Entries expire so a seat change (or an account converted to a service user)
 * is picked up without needing the cache cleared by hand.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** How long a seat lookup stays good. Seat changes are rare; a day is plenty. */
const TTL_MS = 24 * 60 * 60 * 1000;

export interface SeatEntry {
  seatType: string;
  /** Whether the token is a custom agent — only resolved for service users. */
  isCustomAgent?: boolean;
  /** Epoch ms of the lookup. */
  checkedAt: number;
}

type CacheFile = Record<string, SeatEntry>;

function cachePath(): string {
  const base =
    process.env.SC_MCP_CACHE_DIR ??
    process.env.XDG_CACHE_HOME ??
    join(homedir(), '.cache');
  return join(base, 'sc-mcp', 'seats.json');
}

/** Tokens are never written to disk — only this digest. */
function keyFor(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function read(): CacheFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cachePath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CacheFile;
    }
  } catch {
    // Missing, unreadable, or corrupt — treat as empty and re-resolve.
  }
  return {};
}

/** The cached seat for this token, or undefined if absent or stale. */
export function getCachedSeat(token: string, now = Date.now()): SeatEntry | undefined {
  const entry = read()[keyFor(token)];
  if (!entry || typeof entry.seatType !== 'string') return undefined;
  if (!(typeof entry.checkedAt === 'number') || now - entry.checkedAt >= TTL_MS) {
    return undefined;
  }
  return entry;
}

/** Record a seat lookup. Cache failures are never fatal — we just re-resolve next run. */
export function setCachedSeat(
  token: string,
  entry: Omit<SeatEntry, 'checkedAt'>,
  now = Date.now()
): void {
  const path = cachePath();
  try {
    const cache = read();
    cache[keyFor(token)] = { ...entry, checkedAt: now };

    // Drop expired entries so the file doesn't grow without bound.
    for (const [key, value] of Object.entries(cache)) {
      if (typeof value?.checkedAt !== 'number' || now - value.checkedAt >= TTL_MS) {
        delete cache[key];
      }
    }

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache), { mode: 0o600 });
  } catch {
    // Non-fatal by design: a read-only or full disk shouldn't stop the proxy.
  }
}
