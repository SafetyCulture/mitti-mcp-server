/**
 * A minimal Amplitude client: exactly the surface `@amplitude/mcp-analytics`
 * uses — `track`, `flush`, `shutdown` — delivered over `fetch` to Amplitude's
 * HTTP V2 API.
 *
 * Why not `@amplitude/analytics-node`, which that SDK would otherwise construct
 * for us? Because this proxy ships as one bundled file whose tarball installs no
 * transitive dependencies, and that package fights the model at every step:
 *
 *   - it's CJS, and dynamically `require()`s node builtins, which an esbuild ESM
 *     bundle cannot do — it crashes at startup unless the bundle is patched with
 *     a `createRequire` banner;
 *   - the SDK resolves it through `createRequire` at *runtime*, which can never
 *     succeed in a released build, so analytics would be silently dead there;
 *   - it pulls a large dependency tree into a binary customers install, for
 *     retry and offline-queue machinery this use case doesn't need.
 *
 * What it does bring is batching and retries. Neither is worth much here: a
 * session produces a handful of events, and they are flushed when the proxy
 * exits. Losing an event to a failed request is acceptable; delaying a customer's
 * shutdown to retry one is not.
 *
 * Node 20+ has global `fetch`, so this needs no dependency at all.
 */
import type { AmplitudeEvent } from '@amplitude/mcp-analytics';

const INGEST_URL = 'https://api2.amplitude.com/2/httpapi';

/** Matches token-guard.ts: a stalled request must not hang the process. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Send once the queue reaches this many events, so a long session doesn't hold
 * everything in memory until exit.
 */
const AUTO_FLUSH_AT = 20;

/** The logger shape `@amplitude/mcp-analytics` looks for on `configuration`. */
interface AmplitudeLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface AmplitudeHttpClient {
  track(event: AmplitudeEvent): void;
  flush(): Promise<void>;
  shutdown(): void;
  /** Read by the MCP SDK to find `loggerProvider`. */
  configuration: { loggerProvider: AmplitudeLogger };
}

export interface AmplitudeHttpClientOptions {
  apiKey: string;
  log: (message: string) => void;
  /** Overridden in tests. */
  fetchImpl?: typeof fetch;
  /** Overridden in tests. */
  url?: string;
}

export function createAmplitudeHttpClient(opts: AmplitudeHttpClientOptions): AmplitudeHttpClient {
  const { apiKey, log } = opts;
  const send = opts.fetchImpl ?? fetch;
  const url = opts.url ?? INGEST_URL;

  let queue: AmplitudeEvent[] = [];
  let closed = false;
  /** In-flight sends, so a flush on exit waits for auto-flushes already going. */
  const inFlight = new Set<Promise<void>>();

  async function post(events: AmplitudeEvent[]): Promise<void> {
    try {
      const response = await send(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, events }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        // Dropped, not retried: a 400 won't get better, and a customer's exit
        // shouldn't wait on our telemetry.
        log(`analytics: ${events.length} event(s) rejected with ${response.status}`);
      }
    } catch (error: unknown) {
      log(`analytics: ${events.length} event(s) not delivered — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Hand the queue to a request and track it, so `flush` can await it. */
  function dispatch(): void {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    const request = post(batch).finally(() => inFlight.delete(request));
    inFlight.add(request);
  }

  return {
    track(event: AmplitudeEvent) {
      if (closed) return;
      queue.push({
        // Amplitude stamps receipt time if absent, which would attribute an
        // event flushed at exit to the moment of exit rather than the call.
        time: Date.now(),
        // Dedup key, in case a batch is ever delivered twice.
        insert_id: crypto.randomUUID(),
        ...event,
      });
      if (queue.length >= AUTO_FLUSH_AT) dispatch();
    },

    async flush() {
      dispatch();
      await Promise.allSettled(inFlight);
    },

    shutdown() {
      closed = true;
    },

    configuration: {
      loggerProvider: {
        // Amplitude's own debug/info chatter is noise on a customer's terminal;
        // warnings and errors are the ones worth surfacing.
        debug() {},
        info() {},
        warn: (message) => log(`analytics warn: ${message}`),
        error: (message) => log(`analytics error: ${message}`),
      },
    },
  };
}
