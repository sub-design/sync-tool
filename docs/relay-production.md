# Relay Production Deployment

The relay is the always-available NAT traversal path. Deploy it on a public host
behind TLS and keep P2P optional.

## Build

```bash
git clone <repo> /opt/sync-tool
cd /opt/sync-tool
pnpm install --frozen-lockfile
pnpm --filter relay build
```

## Environment

```bash
sudo mkdir -p /etc/sync-tool
sudo cp scripts/systemd/relay.env.example /etc/sync-tool/relay.env
sudo chmod 600 /etc/sync-tool/relay.env
```

Set `RELAY_TOKENS` to one or more `scope:token` entries. Agents with different
scopes cannot discover or route to each other.

## systemd

```bash
sudo useradd --system --home /opt/sync-tool --shell /usr/sbin/nologin synctool
sudo chown -R synctool:synctool /opt/sync-tool
sudo cp scripts/systemd/synctool-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now synctool-relay
sudo systemctl status synctool-relay
```

## Reverse Proxy

Terminate TLS at Caddy, nginx, or your platform proxy and forward WebSocket
traffic to `127.0.0.1:3002`. Preserve `X-Forwarded-Proto`; the relay uses it
when `REQUIRE_SECURE_TRANSPORT=true`.

Example Caddyfile:

```caddyfile
relay.example.com {
  reverse_proxy 127.0.0.1:3002
}
```

## Smoke Test

```bash
RELAY_URL=wss://relay.example.com RELAY_TOKEN=<token> pnpm --filter relay smoke
```

The smoke test registers two temporary clients, checks peer discovery, routes
`relay:data`, routes `relay:signal`, and verifies offline peer notification.

## Monitoring

```bash
curl https://relay.example.com/health
curl https://relay.example.com/metrics
```

Scrape `/metrics` with Prometheus-compatible tooling. Watch:

- `sync_tool_relay_connections`
- `sync_tool_relay_messages_total`
- `sync_tool_relay_bytes_relayed_total`
- `sync_tool_relay_dropped_messages_total`
- `sync_tool_relay_auth_failures_total`
- `sync_tool_relay_oversized_messages_total`
- `sync_tool_relay_rate_limited_clients_total`

## Security Notes

The relay validates every WebSocket message at runtime before routing it. Invalid
JSON, unknown message types, missing required fields, malformed WebRTC signals,
oversized payloads, and noisy clients are rejected fail-closed with
`relay:error` and a policy-close code.

Operational requirements:

- Always use `RELAY_TOKENS` in public deployments.
- Put the relay behind TLS and set `REQUIRE_SECURE_TRANSPORT=true`.
- Keep relay tokens out of process logs and shell history.
- Rotate tokens by adding a new `scope:token`, updating agents, then removing
  the old token.
- Monitor auth failures, invalid messages, oversized messages, rate-limit
  events, and dropped messages.

The relay treats payloads as opaque data. End-to-end file integrity is enforced
by the agent transfer protocol using SHA-256 verification after transfer finish.

## Optional P2P / TURN

Keep `P2P_ENABLED=false` until relay-only sync is stable. To test TURN, configure
agents with:

```bash
P2P_ENABLED=true
P2P_ICE_SERVERS=turn:USERNAME:PASSWORD@turn.example.com:3478
P2P_ICE_TRANSPORT_POLICY=relay
```

If WebRTC fails, transfers continue through the application relay.
