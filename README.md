# sync-tool

A self-hosted file sync tool with a web UI, local agent, and relay server for NAT traversal.

```
packages/
├── shared/    — shared TypeScript types and WebSocket protocol definitions
├── api/       — Express backend: job CRUD, WebSocket hub, cron scheduler
├── agent/     — Local agent: connects to API, executes sync jobs
└── relay/     — Phase A: relay server for NAT traversal (GoodSync Connect analog)
```

---

## Quick start

### Prerequisites

```bash
npm install -g pnpm
```

### Install

```bash
pnpm install
```

### Run (development)

**Terminal 1 — API server**
```bash
pnpm dev:api
# Starts on http://localhost:3001
# Agent WS:   ws://localhost:3001/agent
# Browser WS: ws://localhost:3001/
```

**Terminal 2 — Agent** (runs on the machine that does the actual syncing)
```bash
AGENT_TOKEN=<token from Devices> pnpm dev:agent
# Connects to API server, waits for jobs
```

**Terminal 3 — Web UI** (see Web UI section below)

**Optional: Relay server** (deploy on a VPS with a public IP)
```bash
RELAY_TOKENS=home:$(openssl rand -hex 32) pnpm dev:relay
# Runs on port 3002
```

## Production security baseline

Production deployments should terminate TLS at a reverse proxy or managed
platform and expose only `https://` REST URLs and `wss://` WebSocket URLs.
Set these environment variables for public deployments:

```bash
REQUIRE_SECURE_TRANSPORT=true
ALLOW_LEGACY_WS_QUERY_TOKEN=false

# Agent filesystem sandbox. Default is the user's home directory; add external
# disks or backup roots explicitly.
SYNC_ALLOWED_ROOTS=/Users/alex:/Volumes/Backup

# Preferred over putting encryption keys directly in process env.
SYNC_ENCRYPTION_KEY_FILE=/path/to/sync-tool.key

# Relay namespaces. Agents using token-a can only see and route to other
# devices in scope-a; they cannot address scope-b devices.
RELAY_TOKENS=scope-a:token-a,scope-b:token-b

# New agent tokens expire after this many days. Existing tokens without an
# expiry remain valid until revoked or rotated.
AGENT_TOKEN_TTL_DAYS=90
```

New jobs enable AES-256-GCM file encryption by default. Existing jobs keep
their stored setting. Generate a key file with:

```bash
openssl rand -hex 32 > /path/to/sync-tool.key
chmod 600 /path/to/sync-tool.key
```

Agent tokens can be rotated from the Devices page. Rotation creates a new token
with the same name and revokes the old token. Security events are recorded in
the audit log and visible at `/audit`; the same data is available through
`GET /api/audit`.

---

## API reference

```
GET    /api/jobs           — list all jobs
POST   /api/jobs           — create job { name, source, destination, direction, schedule? }
GET    /api/jobs/:id       — get job
PATCH  /api/jobs/:id       — update job
DELETE /api/jobs/:id       — delete job
POST   /api/jobs/:id/run   — trigger job immediately
POST   /api/jobs/:id/cancel — request cancellation for queued/running job
GET    /api/jobs/:id/log   — sync history
GET    /api/health         — server + connected agents status
```

### Create a job (example)

```bash
curl -X POST http://localhost:3001/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My first sync",
    "source": "/Users/alex/Documents",
    "destination": "/Volumes/Backup/Documents",
    "direction": "ltr"
  }'
```

### Trigger it

```bash
curl -X POST http://localhost:3001/api/jobs/<id>/run
```

---

## Web UI

The web UI is a separate React + Vite + shadcn/ui app. Bootstrap it with:

```bash
cd packages
npm create vite@latest web -- --template react-ts
cd web
npx shadcn@latest init
```

Then set in `web/src/config.ts`:
```ts
export const API_BASE = 'http://localhost:3001'
export const WS_URL   = 'ws://localhost:3001'
```

### Cursor prompts for the Web UI

Use these prompts with Cursor to build each screen:

**Dashboard**
```
Build a dashboard page that connects to ws://localhost:3001 and shows:
- A list of sync jobs from GET /api/localhost:3001/api/jobs
- Each job shows: name, source→destination, direction badge, status badge, last run time
- A "Run" button per job that calls POST /api/jobs/:id/run
- Real-time status updates via WebSocket (ServerToBrowser messages from shared/src/index.ts)
- A connected agents indicator in the header
Use shadcn/ui Card, Badge, Button components.
```

**Job form**
```
Build a job configuration form (create + edit) with:
- Name field
- Source path field with a "Browse" hint
- Destination path field
- Direction selector: Left→Right / Right→Left / Bidirectional (with icons)
- Optional cron schedule field with human-readable preview
- Validation
Calls POST /api/jobs for create, PATCH /api/jobs/:id for edit.
```

**Sync log panel**
```
Build a sync log panel for a job that calls GET /api/jobs/:id/log and shows:
- Timeline of past runs with start time, duration, files copied/skipped/errored
- Expandable error list per run
- Bytes transferred with human-readable formatting (KB/MB/GB)
```

---

## Adding backends (Phase 2+)

The sync engine uses a `StorageBackend` interface defined in `packages/agent/src/sync.ts`.
Backends are resolved automatically from job source/destination schemes:

```text
/local/path                         local filesystem
file:///local/path                   local filesystem
sftp://user:password@host:22/path    SFTP
smb://user:password@host/share/path  SMB via macOS mount_smbfs
nfs://host/export/path               NFS via macOS mount -t nfs
nfs://host/path?export=/srv/share    NFS with explicit export path
```

To add S3, Dropbox, etc., implement the stream-based methods:

```ts
export interface StorageBackend {
  walk(rootPath: string): Promise<Map<string, FileEntry>>
  mkdirp(dirPath: string): Promise<void>
  read(filePath: string): Promise<NodeJS.ReadableStream>
  write(filePath: string, stream: NodeJS.ReadableStream, meta: FileMeta): Promise<void>
  close?(): Promise<void>
}
```

Then add the scheme to `packages/agent/src/backends/resolve.ts`:
```ts
function resolveBackend(location: string): ResolvedBackend {
  if (location.startsWith('s3://')) {
    return createS3Backend(location)
  }
  // ...
}
```

## Delta Sync engine

Delta Sync is implemented as an optional Go binary invoked by the Node agent.
Build it before using `transferMode: "delta"`:

```bash
pnpm build:engine
```

The agent resolves the binary in this order:

```text
SYNC_ENGINE_PATH
packages/sync-engine-go/bin/sync-engine
```

Transfer modes:

```text
auto   default; tries local/mounted delta and falls back to full copy
full   always streams the whole file through the existing backend path
delta  requires the Go engine and local-path-capable source + destination
```

For v1, delta applies when both sides are visible to the same agent as local
filesystem paths (`local`, mounted SMB, mounted NFS). SFTP and other stream-only
backends keep the current full-copy behavior unless a remote agent protocol is
added for that destination.

Two-agent delta is available when both agents are connected to the API and the
same relay. Create the job with device ids:

```json
{
  "name": "Remote documents",
  "source": "/Users/alex/Documents",
  "destination": "/Users/alex/Backup/Documents",
  "direction": "ltr",
  "transferMode": "auto",
  "sourceDeviceId": "source-agent-device-id",
  "destinationDeviceId": "destination-agent-device-id"
}
```

Run both agents with the same relay:

```bash
DEVICE_ID=source-agent-device-id RELAY_URL=ws://localhost:3002 pnpm dev:agent
DEVICE_ID=destination-agent-device-id RELAY_URL=ws://localhost:3002 pnpm dev:agent
```

In this mode, the destination agent sends a manifest and per-file signatures,
the source agent sends delta payloads through relay in 512 KiB chunks, and the
destination agent applies patches locally. New files and files where delta is
not useful fall back to chunked full-file transfer. Bidirectional two-agent jobs
use newer-wins and support delta in both directions when both sides expose local
paths to their agents. New files and non-local-path backends fall back to chunked
full-file transfer in `auto`; strict `transferMode: "delta"` fails instead of
falling back.

Chunk data is sent as one-way relay events with WebSocket backpressure; only
transfer start/finish/abort wait for request-response acknowledgements. The
finish step waits for all queued chunk writes and then performs SHA-256
verification.

Delta apply verifies the final file SHA-256 before accepting the result. Sync
history stores both network bytes and logical bytes so delta efficiency can be
reported separately from file size. Interrupted relay transfers are cleaned from
the destination agent temp directory after 30 minutes. Full-copy fallback also
verifies SHA-256 through backend reads; for stream-only remotes such as SFTP this
adds an extra read after upload.

Queued/running jobs can be cancelled from the API or job detail page.
Cancellation is cooperative: the agent stops between file operations and relay
chunks, aborts active relay transfer sessions, and reports `cancelled`.

### Cursor prompts for Phase 2

**SFTP backend**
```
Implement SftpBackend in packages/agent/src/backends/sftp.ts.
It must implement the StorageBackend interface from sync.ts.
Use the ssh2-sftp-client library.
Parse connection params from a URL like: sftp://user:pass@host:22/path
The walk() method should recursively list all files.
The copyFile() method should stream the file using sftp.fastGet / fastPut.
```

**S3 backend**
```
Implement S3Backend in packages/agent/src/backends/s3.ts.
It must implement the StorageBackend interface from sync.ts.
Use @aws-sdk/client-s3 and @aws-sdk/lib-storage.
Parse connection params from: s3://bucket/prefix?region=us-east-1
walk() should use ListObjectsV2 with pagination.
copyFile() should use Upload from @aws-sdk/lib-storage for multipart.
Preserve mtime in S3 object metadata.
```

---

## Phase A: Relay server (GoodSync Connect)

The relay server is in `packages/relay/`. It's already implemented.

Deploy it on a VPS:
```bash
# On your VPS
git clone ... && cd sync-tool
pnpm install
PORT=3002 pnpm dev:relay   # or use PM2/systemd for production
```

Point agents to it:
```bash
RELAY_URL=wss://your-vps:3002 pnpm dev:agent
```

The relay allows agents on different networks to sync with each other.

**TODO in agent to connect to relay:**
Add relay connection to `agent/src/index.ts` using the `AgentToRelay` / `RelayToAgent`
message types from `shared/src/index.ts`.

---

## Architecture decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend DB | SQLite → Postgres | SQLite works until you need multi-server |
| Sync algorithm | mtime + size | Simple and correct for Phase 1 |
| Phase 4 delta sync | Go process | Node.js is too slow for rsync rolling checksum on large files |
| Agent distribution | ts-node (dev) → pkg (prod) | `pkg` bundles into single executable |
| NAT traversal | Relay first, STUN Phase B | Relay always works; P2P saves bandwidth |

---

## Packaging agent as a standalone executable (Phase 5)

```bash
npm install -g pkg
cd packages/agent
pkg dist/index.js --targets node18-win-x64,node18-mac-x64,node18-linux-x64 --output ../../dist/agent
```

Users download `agent` binary, run it, point it to your API server. No Node.js required.
