/**
 * Startup guard: refuse to run on a service-user token.
 *
 * A SafetyCulture API token can belong to a real person or to a service user
 * (a service account). Service-user tokens are typically far more privileged
 * than any individual — the one this was tested against carried 32 admin/write
 * permissions — and they belong in server-to-server integrations, not behind a
 * desktop MCP client.
 *
 * Nothing here is inferred. The seat type is read from the user's own record:
 *
 *   1. `user:WhoAmI`                        → the token's user id
 *   2. `accounts/GetUser/{uuid}`            → that user's `seat_type`
 *
 * `GetUser` is the key: it answers for the calling token's own record without
 * needing `write:users`, unlike `POST /users/v1/users/list`, which 403s for an
 * ordinary user and so can't tell "not permitted" apart from "service user".
 *
 * Custom agents (AI-900 `agent45` tokens) are service users too, so a bare seat
 * check would lock them out. When the seat says service user we exchange the
 * token for its JWT and let `agent45` through on the `cls` (session class)
 * claim — see AGENT_SESSION_CLASS.
 *
 * The result is cached against a hash of the token (seat-cache.ts) so this
 * costs no API calls on a repeat launch.
 */
import { getCachedSeat, setCachedSeat, type SeatEntry } from './seat-cache.js';

/** Seat type that marks a service account rather than a person. */
const SERVICE_USER_SEAT = 'SUBSCRIPTION_SEAT_TYPE_SERVICE_USER';

/**
 * `cls` (session class) carried by a custom agent's token.
 *
 * Observed classes follow the session type: an `apitoken31` token reports
 * `sc_apitoken31`, so `SESSION_TYPE_AGENT_45` should report `sc_agent45`. That
 * mapping is inferred, not observed — no agent token was available to test. It
 * only ever widens access for agents, never for anything else, and the exact
 * value is worth confirming against a real agent token.
 */
const AGENT_SESSION_CLASS = 'sc_agent45';

/** `user_<32 hex>` → the dashed UUID the accounts endpoints require. */
function toUuid(userId: string): string | undefined {
  const hex = userId.replace(/^user_/, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return undefined;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

async function getJson(url: URL, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${url.pathname} returned ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/** True if the token belongs to a custom agent, which may keep running. */
async function isCustomAgentToken(baseUrl: string, token: string): Promise<boolean> {
  const response = await fetch(new URL('/identity/v1/auth/token', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: token }),
  });
  if (!response.ok) return false;

  const { access_token: accessToken } = (await response.json()) as { access_token?: string };
  const payload = accessToken?.split('.')[1];
  if (!payload) return false;

  try {
    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    ) as { cls?: unknown };
    return claims.cls === AGENT_SESSION_CLASS;
  } catch {
    return false;
  }
}

/** Look the seat up over the network. Only called on a cache miss. */
async function fetchSeat(baseUrl: string, token: string): Promise<SeatEntry> {
  const whoAmI = await getJson(new URL('/accounts/user/v1/user:WhoAmI', baseUrl), token);
  const userId = whoAmI.user_id;
  if (typeof userId !== 'string' || userId === '') {
    throw new Error('WhoAmI returned no user_id');
  }

  const uuid = toUuid(userId);
  if (!uuid) {
    throw new Error(`unexpected user id format: ${userId}`);
  }

  const user = await getJson(
    new URL(`/accounts/organisation/v1/accounts/GetUser/${uuid}`, baseUrl),
    token
  );
  const seatType = (user.user_document as { seat_type?: unknown } | undefined)?.seat_type;
  if (typeof seatType !== 'string' || seatType === '') {
    throw new Error('GetUser returned no seat_type');
  }

  // Only service users need the agent check, so only they pay for the exchange.
  if (seatType !== SERVICE_USER_SEAT) {
    return { seatType, checkedAt: 0 };
  }
  return { seatType, isCustomAgent: await isCustomAgentToken(baseUrl, token), checkedAt: 0 };
}

/**
 * Resolve the token's seat type and reject service users.
 *
 * Throws if the token is a service user, and also if the seat type can't be
 * established — an unverified token doesn't get the benefit of the doubt.
 *
 * The lookup is cached against a hash of the token (see seat-cache.ts), so a
 * repeat launch costs no API calls. Only successes are cached; a failed lookup
 * is retried next run rather than remembered.
 */
export async function assertNotServiceUser(
  baseUrl: string,
  token: string
): Promise<{ seatType: string; cached: boolean }> {
  const cached = getCachedSeat(token);
  const entry = cached ?? (await fetchSeat(baseUrl, token));

  // Record before deciding, so a rejected token doesn't re-resolve every launch.
  if (!cached) {
    setCachedSeat(token, { seatType: entry.seatType, isCustomAgent: entry.isCustomAgent });
  }

  if (entry.seatType === SERVICE_USER_SEAT && !entry.isCustomAgent) {
    throw new Error(
      'this token belongs to a service user. sc-mcp is for tokens that belong to a ' +
        'person — use your own API token from app.safetyculture.com/account/api-tokens.'
    );
  }

  return { seatType: entry.seatType, cached: Boolean(cached) };
}
