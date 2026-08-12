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

/**
 * How long every exit below waits before actually calling `process.exit()`.
 *
 * On Windows, exiting immediately after this process has made any `fetch()`
 * call can abort with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
 * — a libuv/undici race where the connection's handle is still being closed
 * when the process tears down. It's a real, currently-unfixed Node bug
 * (nodejs/node#56645), not something reading the response differently can
 * avoid: reports converge on "delay the exit" as the only workaround that
 * actually holds up. Every path here has made at least one fetch call by the
 * time it exits — the token check, the tracker, or the remote connection —
 * so the delay applies uniformly rather than trying to prove any one call
 * site is safe.
 */
const EXIT_DELAY_MS = 100;

async function fatal(message: string): Promise<never> {
  log(message);
  await new Promise((resolve) => setTimeout(resolve, EXIT_DELAY_MS));
  process.exit(1);
}

// First line out, before anything can fail. Which build is running is the first
// question every investigation asks, and answering it from a log beats inferring
// it from which other lines happen to be present — an npx spec that never changes
// means a customer can be running a months-old build while `latest` says
// otherwise.
log(`version ${VERSION}`);

let config;
try {
  config = resolveConfig(process.env);
} catch (error: unknown) {
  await fatal(error instanceof Error ? error.message : String(error));
}
// Unreachable: fatal() always exits the process. Unlike a synchronous
// `never`-returning call, an awaited one doesn't narrow `config` for the
// type-checker, so this makes that explicit instead of asserting past it.
if (!config) throw new Error('unreachable');
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
  // See EXIT_DELAY_MS above — the tracker and the remote connection both make
  // fetch() calls, so the same Windows exit race applies here.
  await new Promise((resolve) => setTimeout(resolve, EXIT_DELAY_MS));
  process.exit(code);
}

createBridge(local, remote, log, {
  onToolCall: (outcome) => usageTracker.track(outcome),
  onClient: (client) => usageTracker.observeClient(client),
});

local.onclose = () => void shutdown(0);
remote.onclose = () => void shutdown(0);
local.onerror = (error) => log(`stdio error: ${error.message}`);
// Closing the remote transport aborts whatever streams it still has open, and
// those aborts arrive here as errors. They're ours, and they're expected — don't
// report them as though something went wrong.
remote.onerror = (error) => {
  if (!shuttingDown) log(`remote error: ${error.message}`);
};

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

// The client closing stdin is how an MCP stdio server is told to go away, and
// nothing else reports it: StdioServerTransport attaches only 'data' and 'error'
// to stdin, and fires `onclose` only when *we* close it. Without these listeners
// the proxy leans on the event loop draining instead — which works right up until
// a tool call leaves a keep-alive socket open to Mitti, and then the process
// outlives the client that spawned it. Every session that did any real work would
// leak one.
process.stdin.on('end', () => void shutdown(0));
process.stdin.on('close', () => void shutdown(0));

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
  await fatal(`refusing to start — ${error instanceof Error ? error.message : String(error)}`);
}

try {
  await remote.start();
} catch (error: unknown) {
  await fatal(`failed to connect to ${endpoint.href} — check MITTI_API_TOKEN and MITTI_API_URL. ${error instanceof Error ? error.message : String(error)}`);
}
await local.start();
log(`proxying stdio → ${endpoint.href}`);
