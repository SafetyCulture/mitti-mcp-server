/**
 * Usage analytics: which tools get called, by whom, from which MCP client, how
 * long they take, and whether they fail — reported to Amplitude.
 *
 * **What is reported is metadata, and only metadata.** Never the API token,
 * never tool arguments, never tool results. A tool's inputs and outputs are
 * customer data; the fact that `sites_search` was called and took 120ms is not.
 * `bridge.ts` is what enforces that split at the source — it hands over a
 * fixed-shape outcome, not the message.
 *
 * The SDK's convenience API (`instrumentServer` / `instrumentTool`) binds to an
 * `McpServer`/`Server` instance so it can auto-detect the transport and wrap
 * tool handlers. This proxy has neither — `bridge.ts` hand-relays raw JSON-RPC
 * between two bare transports — so there is nothing for those to bind to.
 * Instead this uses the SDK's low-level tracking primitives
 * (`createServerContext` / `createToolContext` + `trackToolEvent`), which its
 * own docs point at for emitting events outside an instrumented handler.
 *
 * The event and property names below are the SDK's reserved ones, so these
 * events land in Amplitude's MCP views alongside servers instrumented the
 * ordinary way.
 *
 * Analytics is a bystander, not a participant: every entry point here swallows
 * its own failures. A bad key, a dead network, or an SDK bug must never break
 * the relay or lose a tool call.
 */
import {
  createMcpAnalytics,
  createServerContext,
  createToolContext,
  type AmplitudeMCPAnalytics,
  type McpServerContext,
} from '@amplitude/mcp-analytics';
import { createAmplitudeHttpClient } from './amplitude.js';
import type { ObservedClient, ToolCallOutcome } from './bridge.js';

/** Reported as `[MCP] Server Name`; also the SDK's server identity. */
const SERVER_NAME = 'mitti-mcp';

const TOOL_CALL_RESPONSE_EVENT = '[MCP] Tool Call Response';
const IS_ERROR_PROPERTY = '[MCP] Is Error';
const RESPONSE_DURATION_PROPERTY = '[MCP] Response Duration';
const ERROR_MESSAGE_PROPERTY = '[MCP] Error Message';

/**
 * Amplitude group type that usage is rolled up by, so "which customers use
 * this" is answerable at all. This string has to match the group type created
 * in the Amplitude project — get it wrong and the events still arrive, they
 * just don't group.
 */
const ORG_GROUP_TYPE = 'org id';

/** Who the calls belong to, resolved once at startup by token-guard.ts. */
export interface AnalyticsIdentity {
  userId: string;
  orgId?: string;
}

export interface ToolUsageTracker {
  /** Record what's on the other end of the pipe, learned from `initialize`. */
  observeClient(client: ObservedClient): void;
  track(outcome: ToolCallOutcome): void;
  /** Flush pending events. The process is short-lived, so this is not optional. */
  shutdown(): Promise<void>;
}

/** What you get when analytics is off — every path here has to keep working. */
export const NOOP_TRACKER: ToolUsageTracker = {
  observeClient() {},
  track() {},
  async shutdown() {},
};

interface TrackerOptions {
  identity: AnalyticsIdentity;
  serverVersion: string;
  log: (message: string) => void;
}

/**
 * Build a tracker over an already-constructed analytics client — the real one,
 * or `MockAmplitudeMCPAnalytics` in tests.
 */
export function createToolCallTracker(analytics: AmplitudeMCPAnalytics, opts: TrackerOptions): ToolUsageTracker {
  const { identity, serverVersion, log } = opts;
  // Learned mid-session: `clientInfo` arrives on the initialize request and the
  // protocol version on its response, so this fills in over two observations
  // and the context is rebuilt per event rather than frozen at startup.
  let client: ObservedClient = {};

  function serverContext(): McpServerContext {
    return createServerContext({
      server: { name: SERVER_NAME, version: serverVersion },
      transport: 'stdio',
      identity: { userId: identity.userId, resolvedFrom: 'explicit' },
      ...(identity.orgId ? { tenant: { groupType: ORG_GROUP_TYPE, groupValue: identity.orgId } } : {}),
      ...(client.name != null || client.version != null
        ? { client: { name: client.name, version: client.version } }
        : {}),
      ...(client.protocolVersion != null ? { protocolVersion: client.protocolVersion } : {}),
    });
  }

  return {
    observeClient(next: ObservedClient) {
      client = { ...client, ...next };
    },

    track({ toolName, durationMs, isError, errorMessage }: ToolCallOutcome) {
      try {
        analytics.trackToolEvent(createToolContext(serverContext(), { name: toolName }), TOOL_CALL_RESPONSE_EVENT, {
          [IS_ERROR_PROPERTY]: isError,
          // Sub-millisecond precision is noise here, and a fractional duration
          // makes for uglier charts than it's worth.
          [RESPONSE_DURATION_PROPERTY]: Math.round(durationMs),
          ...(errorMessage != null ? { [ERROR_MESSAGE_PROPERTY]: errorMessage } : {}),
        });
      } catch (error: unknown) {
        log(`analytics: dropped an event — ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async shutdown() {
      try {
        await Promise.resolve(analytics.flush());
        // A NodeClient has no shutdown of its own — the flush above is what
        // actually gets the buffered events out.
        analytics.shutdown();
      } catch (error: unknown) {
        log(`analytics: flush failed — ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

/**
 * The real tracker, or a no-op when there's no key to report to. No key means
 * no analytics client is ever constructed and no request is ever made to
 * anything but the Mitti API.
 *
 * The delivery client is ours (see amplitude.ts) rather than the one
 * `createMcpAnalytics` builds from an `apiKey`, which cannot work in a released
 * build of this proxy. Passing our own also keeps Amplitude's logging off
 * **stdout** — that's the MCP transport here, and a single `console.log` from a
 * dependency would corrupt the protocol stream.
 */
export function createToolUsageTracker(opts: TrackerOptions & { apiKey: string | undefined }): ToolUsageTracker {
  if (!opts.apiKey) return NOOP_TRACKER;

  try {
    const analytics = createMcpAnalytics({
      amplitude: createAmplitudeHttpClient({ apiKey: opts.apiKey, log: opts.log }),
      serverName: SERVER_NAME,
      serverVersion: opts.serverVersion,
    });
    return createToolCallTracker(analytics, opts);
  } catch (error: unknown) {
    // A client the SDK won't accept disables analytics; it doesn't stop the proxy.
    opts.log(`analytics: disabled — ${error instanceof Error ? error.message : String(error)}`);
    return NOOP_TRACKER;
  }
}
