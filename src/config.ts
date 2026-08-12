/**
 * Startup configuration, resolved from the environment.
 *
 * Pulled out of index.ts so the required-token check and the MITTI_API_URL
 * default/endpoint construction can be tested directly, without touching
 * real transports or process.exit.
 */

import { BAKED_ANALYTICS_KEY } from './build-info.js';

export interface Config {
  token: string;
  baseUrl: string;
  endpoint: URL;
  /** Amplitude ingestion key, or undefined when analytics is off. */
  analyticsApiKey?: string;
}

/** Values of `MITTI_MCP_ANALYTICS` that turn usage analytics off. */
const OFF_VALUES = new Set(['off', 'no', 'false', '0']);

/**
 * Which key — if any — usage analytics reports to.
 *
 * There is deliberately no environment variable for the key itself: usage is
 * reported to our project or to nothing at all. The destination is fixed at
 * release time and cannot be redirected by whatever launches the proxy.
 *
 * The one switch that is honoured is `MITTI_MCP_ANALYTICS=off`, so reporting can
 * be turned off for a given install without cutting a release.
 *
 * Developers point a build at their own Amplitude project by baking a different
 * key in — `PUBLIC_AMPLITUDE_API_KEY=… npm run bundle:release` — not at runtime.
 */
function resolveAnalyticsKey(env: NodeJS.ProcessEnv, bakedKey: string | undefined): string | undefined {
  if (OFF_VALUES.has((env.MITTI_MCP_ANALYTICS ?? '').trim().toLowerCase())) return undefined;
  return bakedKey;
}

// Unchanged by the Mitti rebrand: the API hostname and every endpoint under it
// stay exactly as they were. Only the naming around them moved.
const DEFAULT_BASE_URL = 'https://api.safetyculture.com';

/**
 * Throws a plain Error describing what's wrong; index.ts turns that into a fatal exit.
 *
 * `bakedAnalyticsKey` is a parameter only so tests can exercise the analytics
 * switch without a bundled build. Callers pass nothing.
 */
export function resolveConfig(
  env: NodeJS.ProcessEnv,
  bakedAnalyticsKey: string | undefined = BAKED_ANALYTICS_KEY
): Config {
  const token = env.MITTI_API_TOKEN;
  if (!token) {
    // SC_API_TOKEN was the pre-rebrand name. It is no longer read, but someone
    // still setting it has a working token and a stale variable name — say so,
    // rather than leaving them to guess at "required".
    throw new Error(
      env.SC_API_TOKEN
        ? 'MITTI_API_TOKEN is required (a Mitti API token). Found SC_API_TOKEN — it was renamed to MITTI_API_TOKEN; the token itself is unchanged.'
        : 'MITTI_API_TOKEN is required (a Mitti API token).'
    );
  }

  const baseUrl = env.MITTI_API_URL ?? DEFAULT_BASE_URL;
  const endpoint = new URL('/agents/v1/mcp', baseUrl);
  return { token, baseUrl, endpoint, analyticsApiKey: resolveAnalyticsKey(env, bakedAnalyticsKey) };
}
