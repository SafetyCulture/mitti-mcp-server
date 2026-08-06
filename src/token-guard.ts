/**
 * Startup guard: this proxy is for people, not service accounts.
 *
 * A SafetyCulture API token can belong to a real person or to a service user.
 * Service-user tokens are typically far more privileged than any individual —
 * the one this was tested against carried 32 admin/write permissions — and
 * belong in server-to-server integrations, not behind a desktop MCP client.
 *
 * Every service user is rejected. There is no carve-out — seat type alone
 * decides, so anything running as a service account is turned away.
 *
 * Nothing is inferred. The seat type is read from the user's own record:
 *
 *   1. `user:WhoAmI`             → the token's user id
 *   2. `accounts/GetUser/{uuid}` → that user's `seat_type`
 *
 * `GetUser` is the key: it answers for the calling token's own record without
 * needing `write:users`, unlike `POST /users/v1/users/list`, which 403s for an
 * ordinary user and so can't tell "not permitted" apart from "service user".
 *
 * The result is cached against a hash of the token (seat-cache.ts) so this
 * costs no API calls on a repeat launch.
 */
import { getCachedSeat, setCachedSeat } from './seat-cache.js';

/** Seat type that marks a service account rather than a person. */
const SERVICE_USER_SEAT = 'SUBSCRIPTION_SEAT_TYPE_SERVICE_USER';

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

/** Look the seat up over the network. Only called on a cache miss. */
async function fetchSeatType(baseUrl: string, token: string): Promise<string> {
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
  return seatType;
}

/**
 * Resolve the token's seat type and reject service users.
 *
 * Throws if the token belongs to a service user, and also if the seat type
 * can't be established — an unverified token doesn't get the benefit of the
 * doubt. Only successes are cached; a failed lookup is retried next run.
 */
export async function assertNotServiceUser(
  baseUrl: string,
  token: string
): Promise<{ seatType: string; cached: boolean }> {
  const cached = getCachedSeat(token);
  const seatType = cached?.seatType ?? (await fetchSeatType(baseUrl, token));

  // Record before deciding, so a rejected token doesn't re-resolve every launch.
  if (!cached) {
    setCachedSeat(token, { seatType });
  }

  if (seatType === SERVICE_USER_SEAT) {
    throw new Error(
      'this token belongs to a service user. sc-mcp is for tokens that belong to a ' +
        'person — use your own API token from app.safetyculture.com/account/api-tokens.'
    );
  }

  return { seatType, cached: Boolean(cached) };
}
