#!/usr/bin/env node
/**
 * mitti-mcp — Mitti MCP proxy.
 *
 * Bridges a local stdio MCP client (Claude Desktop, Cursor, MCP Inspector, …)
 * to the Mitti MCP endpoint using a Mitti API token — no OAuth.
 *
 * JSON-RPC messages are piped between the stdio transport (the local client) and
 * a Streamable-HTTP transport (the remote Mitti MCP server), with the API
 * token attached as a bearer on every request. The client drives the MCP protocol
 * (initialize, tools/list, tools/call, …); this process moves messages across the
 * boundary and enforces one policy: **only read-only tools are exposed.**
 *
 * `tools/list` responses are filtered down to tools that declare
 * `readOnlyHint: true`, and `tools/call` requests for anything else are rejected
 * here without reaching Mitti. See read-only.ts for the policy, and
 * bridge.ts for how the relay enforces it on every message that crosses it —
 * only recognised methods and well-formed requests get through; the rest is
 * refused, not passed through by default.
 *
 * Config (env):
 *   MITTI_API_TOKEN          (required)  Mitti API token, from your own user account.
 *   MITTI_API_URL            (optional)  API base URL. Default: https://api.safetyculture.com
 *                                        — unchanged by the rebrand; the endpoints did not move.
 *   MITTI_MCP_ANALYTICS      (optional)  `off` disables usage analytics. There is no
 *                                        variable for the reporting key — that is fixed at
 *                                        release time. See config.ts.
 */
/// <reference types="node" />
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createToolUsageTracker, NOOP_TRACKER, type ToolUsageTracker } from './analytics.js';
import { createBridge } from './bridge.js';
import { VERSION } from './build-info.js';
import { resolveConfig } from './config.js';
import { assertNotServiceUser } from './token-guard.js';

function log(message: string): void {
  // Logs MUST go to stderr — stdout is the MCP transport channel.
  // NOTE: the release workflow asserts the bundle's first stderr line starts
  // with this prefix. Changing it means changing .github/workflows/release.yml.
  process.stderr.write(`mitti-mcp: ${message}\n`);
}

function fatal(message: string): never {
  log(message);
  process.exit(1);
}

let config;
try {
  config = resolveConfig(process.env);
} catch (error: unknown) {
  fatal(error instanceof Error ? error.message : String(error));
}
const { token, baseUrl, endpoint, analyticsApiKey } = config;

const remote = new StreamableHTTPClientTransport(endpoint, {
  requestInit: {
    headers: { Authorization: `Bearer ${token}` },
  },
});
const local = new StdioServerTransport();

/**
 * Replaced with a real tracker once the token's identity is known — usage is
 * attributed to a person and an org, so there is nothing to report before that
 * resolves. Held in a `let` so a signal arriving mid-startup still finds
 * something valid to flush.
 */
let usageTracker: ToolUsageTracker = NOOP_TRACKER;

let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  // The tracker buffers, and this process is short-lived: without the flush,
  // the last events of a session are simply lost.
  await Promise.allSettled([local.close(), remote.close(), usageTracker.shutdown()]);
  process.exit(code);
}

createBridge(local, remote, log, {
  onToolCall: (outcome) => usageTracker.track(outcome),
  onClient: (client) => usageTracker.observeClient(client),
});

local.onclose = () => void shutdown(0);
remote.onclose = () => void shutdown(0);
local.onerror = (error) => log(`stdio error: ${error.message}`);
remote.onerror = (error) => log(`remote error: ${error.message}`);

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

// Reject service-user tokens before opening the relay — see token-guard.ts.
try {
  const identity = await assertNotServiceUser(baseUrl, token);
  log(`token seat type: ${identity.seatType}`);
  usageTracker = createToolUsageTracker({
    apiKey: analyticsApiKey,
    identity: { userId: identity.userId, orgId: identity.orgId },
    serverVersion: VERSION,
    log,
  });
  log(
    analyticsApiKey
      ? 'usage analytics: on — tool names, timings and outcomes only (MITTI_MCP_ANALYTICS=off to disable)'
      : 'usage analytics: off'
  );
} catch (error: unknown) {
  fatal(`refusing to start — ${error instanceof Error ? error.message : String(error)}`);
}

try {
  await remote.start();
} catch (error: unknown) {
  fatal(`failed to connect to ${endpoint.href} — check MITTI_API_TOKEN and MITTI_API_URL. ${error instanceof Error ? error.message : String(error)}`);
}
await local.start();
log(`proxying stdio → ${endpoint.href}`);
