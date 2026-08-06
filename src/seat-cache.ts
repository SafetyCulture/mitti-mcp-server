/**
 * On-disk cache of seat lookups, keyed by a hash of the token.
 *
 * sc-mcp is spawned fresh for every client session, so an in-memory cache would
 * never hit — the seat lookup would run on every launch. This persists the
 * result across runs instead.
 *
 * The token is never stored: the key is its SHA-256, so the file is useless to
 * anyone who reads it. It's also written 0600 — though note that only takes
 * effect on POSIX. Windows ignores everything but the read-only bit, so there
 * the file inherits the directory's ACL. That's why the key is a hash and not
 * the token: the contents are safe to read either way.
 *
 * Entries expire so a seat change (or an account converted to a service user)
 * is picked up without needing the cache cleared by hand.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** How long a seat lookup stays good. Seat changes are rare; a day is plenty. */
const TTL_MS = 24 * 60 * 60 * 1000;

export interface SeatEntry {
  seatType: string;
  /** Epoch ms of the lookup. */
  checkedAt: number;
}

type CacheFile = Record<string, SeatEntry>;

/**
 * Where the cache lives, per platform convention:
 *   Windows  %LOCALAPPDATA%            (falls back to ~/.cache if unset)
 *   macOS /  $XDG_CACHE_HOME or ~/.cache
 *   Linux
 *
 * `SC_MCP_CACHE_DIR` overrides all of it.
 */
function cachePath(): string {
  const base =
    process.env.SC_MCP_CACHE_DIR ??
    (process.platform === 'win32' ? process.env.LOCALAPPDATA : undefined) ??
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

    // Write-then-rename, so a concurrent launch or a kill mid-write can't leave
    // a truncated file behind. rename is atomic on POSIX, and on Windows it
    // replaces the destination rather than failing. Writing the mode on the temp
    // file also means each write lands 0600 — passing `mode` to an existing file
    // would be ignored.
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(cache), { mode: 0o600 });
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  } catch {
    // Non-fatal by design: a read-only or full disk shouldn't stop the proxy.
  }
}
