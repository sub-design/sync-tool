// Bundles the agent into a single self-contained JS file.
// Native addons are marked external because esbuild cannot inline .node files.
import { build } from 'esbuild'
import { createRequire } from 'module'
import { cpSync, mkdirSync, rmSync } from 'fs'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)

mkdirSync('bundle', { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'bundle/index.js',
  external: [
    // Native addons — cannot be bundled into a single JS file.
    'better-sqlite3',
    'node-datachannel', // WebRTC P2P (optional relay feature), uses ESM + native .node
    'fsevents',         // chokidar on macOS (falls back to polling)
    'cpu-features',     // ssh2 perf (optional)
    'sshcrypto',        // ssh2 crypto (optional, falls back to pure JS)
    '*.node',
  ],
  // Don't minify — stack traces stay readable in logs
  minify: false,
  sourcemap: false,
  // Suppress "require() of ES module" dynamic-require warnings
  logLevel: 'warning',
})

const betterSqlitePackage = require.resolve('better-sqlite3/package.json')
const betterSqliteRequire = createRequire(betterSqlitePackage)

copyRuntimePackage('better-sqlite3', require)
copyRuntimePackage('bindings', betterSqliteRequire)
copyRuntimePackage('file-uri-to-path', betterSqliteRequire)

console.log('✓ Agent bundled → bundle/index.js')

function copyRuntimePackage(name, resolver) {
  const packageDir = dirname(resolver.resolve(`${name}/package.json`))
  const targetDir = join('bundle', 'node_modules', name)
  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(dirname(targetDir), { recursive: true })
  cpSync(packageDir, targetDir, {
    recursive: true,
    dereference: true,
    filter: (src) => !src.includes(`${packageDir}/build/Debug`),
  })
}
