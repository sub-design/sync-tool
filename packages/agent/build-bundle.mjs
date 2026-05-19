// Bundles the agent into a single self-contained JS file.
// Native addons are marked external because esbuild cannot inline .node files.
import { build } from 'esbuild'
import { mkdirSync } from 'fs'

mkdirSync('bundle', { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'bundle/index.js',
  external: [
    // Native addons — cannot be bundled into a single JS file.
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

console.log('✓ Agent bundled → bundle/index.js')
