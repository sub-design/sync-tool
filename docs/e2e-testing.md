# E2E Testing

The remote-agent e2e tests need PostgreSQL because they exercise the API,
scheduler/job state, agent registration, relay registration, and sync logs.

## Start Test PostgreSQL

With Docker running:

```bash
DATABASE_URL="$(scripts/start-test-postgres-docker.sh | tail -1 | cut -d= -f2-)"
export DATABASE_URL
```

The default test database is:

```bash
postgresql://postgres@127.0.0.1:55432/sync_tool
```

Override the port if needed:

```bash
SYNC_TOOL_TEST_POSTGRES_PORT=55433 scripts/start-test-postgres-docker.sh
```

## Run

```bash
pnpm build:engine
pnpm test:e2e
```

Or run the whole flow with Docker PostgreSQL managed automatically:

```bash
pnpm test:e2e:docker
```

Set `KEEP_TEST_POSTGRES=true` to keep the container after the run for debugging.

The e2e file currently covers:

- watch-triggered local sync;
- scheduled local sync;
- two-agent remote rename detection through relay;
- two-agent remote full transfer through relay;
- two-agent remote delta transfer through relay.

If PostgreSQL is not reachable, these tests skip instead of failing.

## Stop Test PostgreSQL

```bash
scripts/stop-test-postgres-docker.sh
```
