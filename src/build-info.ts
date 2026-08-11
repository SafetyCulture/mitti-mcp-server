/**
 * Constants injected at bundle time by esbuild's `--define` — see the `bundle`
 * and `bundle:release` scripts in package.json.
 *
 * Both are read through an inline `typeof` guard, and that shape is load-bearing:
 * when a build doesn't define one, the identifier simply isn't declared in the
 * output, and *any* other reference to it — including passing it to a helper —
 * throws `ReferenceError` at startup. `typeof` on an undeclared identifier is
 * the one form that's safe. So the guard can't be factored out into a shared
 * function, however repetitive it looks.
 *
 * Unbundled runs (`npm run build`, the test suite) define neither, and fall back
 * to the values below.
 */
declare const __MITTI_VERSION__: string | undefined;
declare const __MITTI_ANALYTICS_KEY__: string | undefined;

/**
 * The proxy's own version, from package.json via npm's `npm_package_version`.
 *
 * Deliberately not read from package.json at runtime: the release publishes the
 * bundle as a standalone `mitti-mcp.mjs` too, and that file gets run on its own
 * with no package.json beside it — a `require('../package.json')` would throw
 * there, which is exactly what the release workflow's isolated-bundle check runs
 * into.
 */
export const VERSION: string =
  typeof __MITTI_VERSION__ === 'string' && __MITTI_VERSION__ !== '' ? __MITTI_VERSION__ : '0.0.0-dev';

/**
 * Amplitude ingestion key for usage analytics, baked in at release time from a
 * repository secret. Absent in local builds, which is why analytics is off by
 * default when you run from source.
 *
 * This key ships inside the published bundle, so it is public by construction —
 * it must only ever be an Amplitude *API key* (write-only ingestion), never the
 * project's secret key.
 */
export const BAKED_ANALYTICS_KEY: string | undefined =
  typeof __MITTI_ANALYTICS_KEY__ === 'string' && __MITTI_ANALYTICS_KEY__ !== ''
    ? __MITTI_ANALYTICS_KEY__
    : undefined;
