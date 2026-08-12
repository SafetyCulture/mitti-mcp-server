// Bundles src/index.ts into dist/mitti-mcp.mjs.
//
// Runs as plain Node rather than a package.json one-liner so the version and
// analytics key are read from `process.env` instead of shell-interpolated —
// `$npm_package_version` is bash/zsh syntax and silently doesn't expand under
// Windows' cmd.exe or PowerShell, which is what `npm run bundle` (via the
// `prepare` lifecycle script) actually uses there. npm sets the same
// `npm_package_*` and custom env vars on every platform; only the shell syntax
// to read them differs, so reading via `process.env` sidesteps that entirely.
import { build } from 'esbuild';

const define = {
  __MITTI_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0-dev'),
};
// Absent for a source build (npm run bundle) — analytics is off there by
// design. Set for a release build (npm run bundle:release), which requires it.
if (process.env.PUBLIC_AMPLITUDE_API_KEY) {
  define.__MITTI_ANALYTICS_KEY__ = JSON.stringify(process.env.PUBLIC_AMPLITUDE_API_KEY);
}

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/mitti-mcp.mjs',
  define,
});
