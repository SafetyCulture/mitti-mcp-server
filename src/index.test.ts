/**
 * Exercises the actual entrypoint as a subprocess — the config resolution,
 * the service-user guard, and the transport/shutdown wiring in index.ts
 * can't be driven in-process (they construct real transports and call
 * process.exit), so this spawns the compiled script the way a real MCP
 * client would run it, against a stand-in SafetyCulture API.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:http';

const INDEX_JS = new URL('./index.js', import.meta.url).pathname;

const USER_ID = 'user_d8d0b3ecb34a482ead73e963b3a4e7e2';

/** Stands in for the SafetyCulture calls token-guard.ts makes at startup. */
function mockSafetyCulture(seatType: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url?.endsWith('user:WhoAmI')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ user_id: USER_ID }));
        return;
      }
      if (req.url?.includes('/accounts/GetUser/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ user_document: { seat_type: seatType } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** Spawn the compiled entrypoint with a clean env, collecting stderr as it arrives. */
function spawnProxy(env: Partial<Record<'SC_API_TOKEN' | 'SC_API_URL', string>>) {
  const base = { ...process.env };
  delete base.SC_API_TOKEN;
  delete base.SC_API_URL;

  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [INDEX_JS], {
    env: { ...base, ...env },
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  function waitForStderr(pattern: RegExp, timeoutMs = 5000): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const tryMatch = () => pattern.test(stderr);
      if (tryMatch()) {
        resolvePromise();
        return;
      }
      const timer = setTimeout(() => {
        child.stderr.off('data', onData);
        reject(new Error(`timed out waiting for stderr to match ${pattern}. Got so far:\n${stderr}`));
      }, timeoutMs);
      function onData(): void {
        if (tryMatch()) {
          clearTimeout(timer);
          child.stderr.off('data', onData);
          resolvePromise();
        }
      }
      child.stderr.on('data', onData);
    });
  }

  function waitForExit(): Promise<number | null> {
    return new Promise((resolvePromise) => {
      child.on('exit', (code) => resolvePromise(code));
    });
  }

  return { child, waitForStderr, waitForExit };
}

test('exits 1 with a clear error when SC_API_TOKEN is missing', async () => {
  const proxy = spawnProxy({});
  await proxy.waitForStderr(/SC_API_TOKEN is required/);
  assert.equal(await proxy.waitForExit(), 1);
});

test('exits 1 and refuses to start for a service-user token', async () => {
  const mock = await mockSafetyCulture('SUBSCRIPTION_SEAT_TYPE_SERVICE_USER');
  try {
    const proxy = spawnProxy({ SC_API_TOKEN: 'scapi_test', SC_API_URL: mock.url });
    await proxy.waitForStderr(/refusing to start.*service user/s);
    assert.equal(await proxy.waitForExit(), 1);
  } finally {
    await mock.close();
  }
});

test('starts the relay and shuts down cleanly on SIGTERM', async () => {
  const mock = await mockSafetyCulture('SUBSCRIPTION_SEAT_TYPE_PREMIUM');
  try {
    const proxy = spawnProxy({ SC_API_TOKEN: 'scapi_test', SC_API_URL: mock.url });
    await proxy.waitForStderr(/proxying stdio →/);
    proxy.child.kill('SIGTERM');
    assert.equal(await proxy.waitForExit(), 0);
  } finally {
    await mock.close();
  }
});
