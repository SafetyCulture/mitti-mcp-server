/**
 * Usage analytics: which tools get called, by whom, from which MCP client, how
 * long they take, and whether they fail — posted to Amplitude as they happen.
 *
 * **Metadata only.** Never the API token, never tool arguments, never tool
 * results. A tool's inputs and outputs are customer data; the fact that
 * `sites_search` was called and took 120ms is not. `bridge.ts` enforces that at
 * the source — it hands over a fixed-shape outcome, not the message.
 *
 * The event and property names are Amplitude's reserved MCP ones, so these land
 * in its MCP views alongside servers instrumented with its SDK. Writing them
 * literally is the whole reason this file needs no dependency: that vocabulary is
 * a list of strings, and `@amplitude/mcp-analytics` earns nothing else here. Its
 * context plumbing, handler wrapping and identity fallbacks are all for servers
 * built on `McpServer`; this proxy hand-relays raw JSON-RPC between two bare
 * transports. Using 5% of it cost three separate bugs — a CJS transport that
 * can't be bundled, an `init()` it doesn't await, and a logger that writes to
 * stdout, which here *is* the MCP transport — plus placeholder properties
 * ("no-session", "anonymous", "unknown") that say nothing.
 *
 * Each event is sent when it happens. No queue, no batching: a session produces a
 * handful of events, the sends are off the critical path, and an event held in
 * memory is an event that can be lost — v0.3.0's events were correct and simply
 * never left the process. The one piece of machinery here is the in-flight set:
 * `track` is called synchronously from the relay so it cannot await delivery, and
 * shutdown calls `process.exit()`, which would cut off requests still in the air.
 *
 * Analytics is a bystander. Every entry point swallows its own failures: a bad
 * key, a dead network or a bug here must never break the relay or lose a call.
 */
import type { ObservedClient, ToolCallOutcome } from './bridge.js';

const INGEST_URL = 'https://api2.amplitude.com/2/httpapi';

/** Matches token-guard.ts: a stalled request must not hang the process. */
const REQUEST_TIMEOUT_MS = 10_000;

const SERVER_NAME = 'mitti-mcp';
const TOOL_CALL_RESPONSE_EVENT = '[MCP] Tool Call Response';

/**
 * Amplitude group type that usage is rolled up by, so "which customers use this"
 * is answerable at all. Must match the group type created in the Amplitude
 * project — get it wrong and events still arrive, they just don't group.
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
  /** Wait for sends still in the air. The process exits right after. */
  shutdown(): Promise<void>;
}

/** What you get when analytics is off — every path here has to keep working. */
export const NOOP_TRACKER: ToolUsageTracker = {
  observeClient() {},
  track() {},
  async shutdown() {},
};

export interface TrackerOptions {
  apiKey: string | undefined;
  identity: AnalyticsIdentity;
  serverVersion: string;
  log: (message: string) => void;
  /** Overridden in tests. */
  fetchImpl?: typeof fetch;
  /** Overridden in tests. */
  url?: string;
}

/**
 * The real tracker, or a no-op when there's no key to report to. No key means no
 * request is ever made to anything but the Mitti API.
 */
export function createToolUsageTracker(opts: TrackerOptions): ToolUsageTracker {
  const { apiKey, identity, serverVersion, log } = opts;
  if (!apiKey) return NOOP_TRACKER;

  const send = opts.fetchImpl ?? fetch;
  const url = opts.url ?? INGEST_URL;
  const inFlight = new Set<Promise<void>>();
  let client: ObservedClient = {};

  async function post(event: Record<string, unknown>): Promise<void> {
    try {
      const response = await send(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, events: [event] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        // Dropped, not retried: a 400 won't get better, and a customer's exit
        // shouldn't wait on our telemetry.
        log(`analytics: event rejected with ${response.status}`);
      }
    } catch (error: unknown) {
      log(`analytics: event not delivered — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    observeClient(next: ObservedClient) {
      client = next;
    },

    track({ toolName, durationMs, isError, errorMessage }: ToolCallOutcome) {
      try {
        const request = post({
          event_type: TOOL_CALL_RESPONSE_EVENT,
          user_id: identity.userId,
          ...(identity.orgId ? { groups: { [ORG_GROUP_TYPE]: identity.orgId } } : {}),
          time: Date.now(),
          // Dedup key, in case a request is ever delivered twice.
          insert_id: crypto.randomUUID(),
          event_properties: {
            '[MCP] Server Name': SERVER_NAME,
            '[MCP] Server Version': serverVersion,
            '[MCP] Transport': 'stdio',
            '[MCP] Tool Name': toolName,
            '[MCP] Is Error': isError,
            // Sub-millisecond precision is noise, and fractional durations make
            // for uglier charts than they're worth.
            '[MCP] Response Duration': Math.round(durationMs),
            ...(client.name != null ? { '[MCP] Client Name': client.name } : {}),
            ...(client.version != null ? { '[MCP] Client Version': client.version } : {}),
            ...(errorMessage != null ? { '[MCP] Error Message': errorMessage } : {}),
          },
        }).finally(() => inFlight.delete(request));
        inFlight.add(request);
      } catch (error: unknown) {
        log(`analytics: dropped an event — ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async shutdown() {
      // Looped rather than a single await: a response arriving as the proxy shuts
      // down can start one more send while this is waiting.
      while (inFlight.size > 0) {
        await Promise.allSettled(inFlight);
      }
    },
  };
}
