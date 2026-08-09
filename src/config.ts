/**
 * Startup configuration, resolved from the environment.
 *
 * Pulled out of index.ts so the required-token check and the MITTI_API_URL
 * default/endpoint construction can be tested directly, without touching
 * real transports or process.exit.
 */

export interface Config {
  token: string;
  baseUrl: string;
  endpoint: URL;
}

// Unchanged by the Mitti rebrand: the API hostname and every endpoint under it
// stay exactly as they were. Only the naming around them moved.
const DEFAULT_BASE_URL = 'https://api.safetyculture.com';

/** Throws a plain Error describing what's wrong; index.ts turns that into a fatal exit. */
export function resolveConfig(env: NodeJS.ProcessEnv): Config {
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
  return { token, baseUrl, endpoint };
}
