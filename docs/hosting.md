# Self-Hosting

## Overview

Welcome!  xyOps is designed to be straightforward to self-host.  You can try the entire product with one Docker command, then move to a persistent single-conductor installation when you are ready.  More advanced topics such as TLS, reverse proxies, external storage, multiple conductors, and air-gapped operation come later in this guide.

There are two pieces to know about:

- The **conductor** runs the xyOps web interface, API, scheduler, and database.
- **xySat** (xyOps Satellite) is the lightweight worker agent installed on servers where jobs run and metrics are collected.

For a first test, both pieces can run together in one disposable container.

Use the guide at your own pace:

- To explore xyOps right now, start with [Quick-Start](#quick-start).
- To keep the installation, read [Before You Install](#before-you-install) and use the persistent Docker command.
- To add job runners, continue to [Satellite](#satellite).
- To publish xyOps securely, read [TLS](#tls) and [Reverse Proxies and Worker Connections](#reverse-proxies-and-worker-connections).
- For production redundancy, begin with [External Storage](#external-storage), then move to [Multi-Conductor with Nginx](#multi-conductor-with-nginx).

## Quick-Start

### Try xyOps Without Saving Anything

This command starts a completely disposable xyOps container.  It has no volumes, no bind mounts, and no permanent data.  It also starts a local xySat worker inside the same container, so you can run jobs immediately.

```sh
docker run --detach --rm --init --name xyops-try --hostname xyops-try -e XYOPS_masters="xyops-try" -e XYOPS_xysat_local="true" -e XYOPS_base_app_url="http://localhost:5522" -e TZ="America/Los_Angeles" -p 5522:5522 ghcr.io/pixlcore/xyops:latest
```

Open [http://localhost:5522/](http://localhost:5522/) and sign in with:

- **Username:** `admin`
- **Password:** `admin`

Change the `TZ` value if you want the test container to use a different timezone.

When you are finished, stop the container:

```sh
docker stop xyops-try
```

Because the container was started with `--rm`, Docker removes it automatically after it stops.  All xyOps data, configuration, jobs, and history from this trial are discarded.

> [!NOTE]
> This command is only for exploring xyOps on the Docker host.  The temporary hostname `xyops-try` is not intended for remote worker servers, and the setup has no persistent storage.  Continue below before building anything you want to keep.

### Keep It: A Persistent Single-Conductor Setup

For a persistent installation, first choose a stable hostname that every future worker server can resolve and reach.  The examples use `xyops01.internal.mycompany.com`.  Replace this everywhere with your real hostname.

```sh
docker run \
	--detach \
	--init \
	--name "xyops-conductor-1" \
	--hostname "xyops01.internal.mycompany.com" \
	-e XYOPS_masters="xyops01.internal.mycompany.com" \
	-e XYOPS_base_app_url="http://xyops01.internal.mycompany.com:5522" \
	-e XYOPS_xysat_local="true" \
	-e TZ="America/Los_Angeles" \
	-v xyops-data:/opt/xyops/data \
	-v ./xyops-conf:/opt/xyops/conf \
	-v ./xyops-logs:/opt/xyops/logs \
	--restart unless-stopped \
	-p 5522:5522 \
	-p 5523:5523 \
	ghcr.io/pixlcore/xyops:latest
```

This setup keeps:

- Application data in the Docker volume `xyops-data`.
- Configuration in `./xyops-conf` on the Docker host.
- Logs in `./xyops-logs` on the Docker host.

xyOps creates the configuration files automatically on first launch.  Open `http://xyops01.internal.mycompany.com:5522/` after the hostname resolves on your network.

The local xySat worker is convenient for a home lab or initial evaluation.  For a production conductor, remove `XYOPS_xysat_local` and install xySat on separate worker servers instead.

If jobs need to launch Docker containers, you may also bind the Docker socket into xyOps:

```sh
-v /var/run/docker.sock:/var/run/docker.sock
```

This grants the xyOps container powerful access to the Docker host, so only add it when you need the Docker Plugin or container-based [Marketplace](https://marketplace.xyops.io) plugins.

## Before You Install

The persistent command above is intentionally simple.  Before adding remote workers or putting xyOps behind a proxy, take a moment to understand the few network values used by xyOps.

### Conductor Hostname

The conductor hostname is the permanent network identity of a xyOps conductor.  By default, xyOps uses the hostname reported by the operating system.  In Docker, this is the container hostname.

Set it with one of these methods:

- Docker: `--hostname "xyops01.internal.mycompany.com"`
- Docker Compose: `hostname: xyops01.internal.mycompany.com`
- Any installation: `XYOPS_hostname="xyops01.internal.mycompany.com"`

The hostname must be:

- Stable across restarts.
- Resolvable from every worker server.
- Reachable from every worker server.
- Reachable from every other conductor in a multi-conductor cluster.

For one conductor, `XYOPS_masters` should contain that exact hostname.  For multiple conductors, it should contain every conductor hostname as a comma-separated list.

Do not use `localhost`, a random container ID, or a Docker-only alias for a persistent deployment.  Those names may work inside one machine while failing everywhere else.

### The Important URLs and Settings

Several settings contain words such as "host", "URL", and "base", but they solve different problems:

| Name | Meaning |
|------|---------|
| Conductor hostname | The stable identity of one conductor.  By default, this is where xySat connects. |
| [`base_app_url`](config.md#base_app_url) | The URL people should open.  xyOps uses it to create links in emails, alerts, tickets, and web hooks.  It does not control xySat connections. |
| [`WebServer.port`](config.md#webserver-port) | The built-in HTTP and `ws://` listener.  The default is `5522`. |
| [`WebServer.https_port`](config.md#webserver-https_port) | The built-in HTTPS and `wss://` listener.  The default is `5523`. |
| [`satellite.config`](config.md#satellite-config) | Connection and runtime settings sent to xySat, including `host` or `hosts`, `port`, and `secure`. |
| [`satellite.base_url`](config.md#satellite-base_url) | The upstream release location where the conductor obtains xySat packages.  Workers do not connect to this URL. |

A common production layout uses different names for people and workers:

- **Conductor hostname:** `xyops01.internal.mycompany.com`
- **Human-facing URL:** `https://xyops.mycompany.com`
- **xySat connection:** `ws://xyops01.internal.mycompany.com:5522`

This is expected.  Browsers enter through the public proxy, while workers connect directly to the conductor.

### Ports 5522 and 5523

The built-in ports are shared by the web interface, API, installer downloads, and WebSockets:

| Port | Protocols | Default Use |
|------|-----------|-------------|
| `5522` | HTTP and `ws://` | Non-TLS browser, API, and xySat traffic. |
| `5523` | HTTPS and `wss://` | TLS browser, API, and xySat traffic. |

Port `5522` is not a xySat-only port.  A client which can reach it can also reach the xyOps web interface and API.  Use an application-aware reverse proxy if you require stricter separation.

For direct xySat connections, keep these pairs together:

- **Without TLS:** Port `5522` with `secure` set to `false` uses HTTP and `ws://`.
- **With TLS:** Port `5523` with `secure` set to `true` uses HTTPS and `wss://`.

### Network Traffic Direction

xySat always initiates its connection to the conductor.  It does not open an inbound service for the conductor to call.

Plan for these traffic paths:

- Browsers connect to `base_app_url`.
- Workers make outbound HTTP or HTTPS requests during installation.
- Workers maintain an outbound WebSocket to a conductor or worker-facing proxy.
- Conductors connect to each other in a multi-conductor cluster.
- The conductor downloads release metadata and xySat packages unless air-gapped mode is used.

### Common Network Layouts

| Layout | Human URL | xySat Route | Worker Access Needed |
|--------|-----------|-------------|----------------------|
| Direct HTTP | `http://xyops01.internal.mycompany.com:5522` | Direct to conductor | TCP `5522` |
| Direct HTTPS | `https://xyops01.internal.mycompany.com:5523` | Direct to conductor | TCP `5523` |
| Browser proxy only | `https://xyops.mycompany.com` | Direct to each conductor | Conductor port `5522` or `5523` |
| Browser and worker proxy | Public UI hostname plus a worker-facing hostname | Through proxy | Usually TCP `443` to proxy |

Use direct worker-to-conductor connections when your network permits them.  They are simple, efficient, and allow xySat to fail over directly between conductors.  Use a worker-facing proxy when direct routing is not possible.

### Test From a Worker First

Before installing xySat, test the exact hostname and port from the worker server itself.  For the default HTTP listener:

```sh
getent hosts xyops01.internal.mycompany.com
curl -fsS http://xyops01.internal.mycompany.com:5522/api/app/ping
```

The first command should resolve an address and the second should return a successful response.  Use the DNS lookup tool provided by your operating system if `getent` is unavailable.

Fix DNS, routing, certificate, or firewall problems before running the installer.  A browser working on your laptop does not prove that a worker server can reach the same address.

## Satellite

xyOps Satellite, or [xySat](https://github.com/pixlcore/xysat), is the worker agent.  It executes jobs, reports status, and collects monitoring data.  xySat is available for Linux, macOS, Windows, and Docker.

The easiest installation path is built into xyOps:

1. Open **Servers**.
2. Click **Add Server**.
3. Choose the target platform and any optional server settings.
4. Copy the generated command.
5. Run it on the worker server.

The server should appear in xyOps within a few seconds.  See [Servers](servers.md) for Docker worker examples, automated provisioning, groups, and server lifecycle management.

### What The Installer Does

The generated command downloads a small bootstrap script from the conductor.  That script:

1. Confirms that the worker can reach xyOps.
2. Detects the worker operating system and CPU architecture.
3. Downloads the correct xySat package through the conductor.
4. Downloads a generated worker configuration.
5. Installs xySat as a startup service.
6. Starts xySat, which opens an outbound WebSocket to xyOps.

The generated configuration includes a unique server ID, an authentication token, the conductor connection settings, and any initial label, icon, or group choices.

The `t=` value in the installer URL is a temporary bootstrap token.  It expires after 24 hours.  Treat the full installer command as sensitive and never paste a live token into a public issue, chat, or log.

### Satellite Configuration

The conductor centrally manages xySat through [`satellite.config`](config.md#satellite-config).  The default connection settings are:

```json
{
	"port": 5522,
	"secure": false,
	"socket_opts": { "rejectUnauthorized": false }
}
```

The complete object also includes logging, monitoring, temporary directory, process, and upgrade settings.  See [`satellite.config`](config.md#satellite-config) for the full reference.

Connection properties are:

| Property | Purpose |
|----------|---------|
| `hosts` | The conductor hostnames xySat may contact.  xyOps creates and updates this list automatically. |
| `host` | An optional static hostname which overrides `hosts` completely. |
| `port` | The conductor or proxy port used for bootstrap HTTP and WebSocket traffic. |
| `secure` | `false` selects HTTP and `ws://`; `true` selects HTTPS and `wss://`. |
| `socket_opts` | Advanced options for the persistent WebSocket client, including its TLS certificate behavior.  These options do not apply to installation or upgrade downloads. |

On initial install, xyOps supplies the current conductor hostname.  After xySat authenticates, the primary conductor sends the complete conductor list.  This lets workers discover the primary and fail over without manual edits.

The conductor continues to synchronize managed settings after installation.  Change fleet-wide settings on the conductor rather than editing every worker.

### Overriding The Connect URL

Most installations should use the automatic `hosts` list.  Set a static `host` only when workers must use a proxy, load balancer, or special network route.

To override every worker, add `host` to the conductor's existing `satellite.config` object.  For Docker, environment variables are the simplest option:

```sh
-e XYOPS_satellite__config__host="xyops-workers.mycompany.com" \
-e XYOPS_satellite__config__port="443" \
-e XYOPS_satellite__config__secure="true"
```

This sends all xySat bootstrap and connection traffic to `https://xyops-workers.mycompany.com` and `wss://xyops-workers.mycompany.com` on port `443`.

When both `host` and `hosts` exist, `host` wins.  In a multi-conductor cluster, the static hostname must point to a proxy which can route workers to the current primary.  Otherwise, a static host removes the direct failover benefit of the conductor list.

To override only one worker, edit its local configuration at `/opt/xyops/satellite/config.json`.

Add a top-level `host` property and configure `managed_keys` so the conductor does not replace that property during synchronization.

### Customizing Managed Keys

By default, the conductor manages the entire xySat configuration.  A worker can limit which properties the conductor may replace by defining `managed_keys` locally.

For example:

```json
"managed_keys": [ "server_id", "auth_token", "hosts" ]
```

This allows the conductor to update only those three properties.  All omitted properties remain local to that worker.

Always include `auth_token`.  Secret key rotation requires the conductor to issue a new worker token.  If you only want to preserve a local `host`, include every other setting you still want centrally managed and omit only `host`.

### Troubleshooting xySat Installation

Troubleshoot from the worker server, not only from the conductor or your laptop.

| Symptom | What It Usually Means | Check |
|---------|-----------------------|-------|
| The installer uses `5522`, but the UI is on `80` or `443`. | This may be correct.  Workers can connect directly while browsers use a proxy. | Confirm the intended layout and test the conductor hostname from the worker. |
| The generated command has the wrong hostname. | The conductor hostname or static satellite `host` is wrong. | Check Docker `hostname`, `XYOPS_hostname`, `XYOPS_masters`, and `satellite.config.host`. |
| The installer cannot reach the conductor. | The conductor hostname, port, DNS, route, proxy, or firewall is wrong. | Repeat the worker connectivity test and verify the generated install command uses the intended conductor address. |
| Installation finishes, but the server stays offline. | HTTP downloads worked, but the WebSocket did not. | Check `host` or `hosts`, `port`, `secure`, proxy Upgrade handling, and proxy timeouts. |
| TLS fails. | The certificate is untrusted, does not match the hostname, or the port and `secure` setting disagree. | Test the exact HTTPS URL from the worker and confirm that the worker operating system trusts the full certificate chain. |
| The conductor cannot provide the package. | It cannot download xySat, or an offline package is missing. | Check `satellite.base_url`, outbound proxy access, cache logs, or the air-gapped bucket. |

On Linux and macOS, inspect the generated configuration at `/opt/xyops/satellite/config.json`.

Confirm `host` or `hosts`, `port`, `secure`, and `server_id`.  Do not share `auth_token`.

## TLS

xyOps can terminate TLS itself or run behind a TLS-terminating reverse proxy.

For built-in TLS, provide a certificate and private key trusted for the conductor hostname.  See the [pixl-server-web certificate guide](https://github.com/jhuckaby/pixl-server-web#lets-encrypt--acme-tls-certificates) and the [`WebServer`](config.md#webserver) configuration reference.

For xySat to connect directly to the default secure listener, set:

```json
"port": 5523,
"secure": true
```

Set `base_app_url` separately to the HTTPS URL people use.  Changing `base_app_url` does not change xySat connection settings.

The persistent xySat WebSocket can customize certificate handling through `socket_opts`, but installation and upgrades do not use those options.  Their bootstrap scripts download files using `curl` or `wget` on Linux and macOS, and `Invoke-WebRequest` on Windows.  These tools require the conductor or proxy certificate to be trusted by the worker operating system.

For the complete managed xySat lifecycle to work over HTTPS, use a certificate signed by a public CA, a private CA installed in the trust store of every worker, or a TLS-terminating proxy with a trusted certificate.  Do not rely on `socket_opts.rejectUnauthorized` to make a self-signed certificate work for installation or upgrades.  For a simple test on a trusted private network, use the HTTP listener on port `5522` instead of HTTPS with an untrusted certificate.

## Reverse Proxies and Worker Connections

A reverse proxy can serve people, workers, or both.  Decide which traffic should pass through it before changing URLs.

### Proxying Browsers Only

This is the simplest proxy layout:

- **Browsers:** Connect to `https://xyops.mycompany.com`, which the reverse proxy forwards to conductor port `5522`.
- **xySat:** Connects directly to `ws://xyops01.internal.mycompany.com:5522`.

Set the human-facing URL:

```sh
XYOPS_base_app_url="https://xyops.mycompany.com"
```

Keep the conductor's internal hostname stable.  Generated xySat installers continue to use that hostname and the port from `satellite.config`.  Workers do not need access to the public proxy port if they connect directly.

The proxy should forward WebSockets for browser live updates, preserve the public `Host`, and forward the original protocol using a header such as `X-Forwarded-Proto`.

### Proxying xySat

Use a worker-facing proxy when workers cannot route directly to conductors.  Configure the proxy hostname with `satellite.config.host`, as described in [Overriding The Connect URL](#overriding-the-connect-url).

The proxy must support more than a single WebSocket:

- xySat bootstrap, configuration, package, and upgrade requests.
- Job-related uploads and downloads.
- Persistent WebSocket upgrades.
- Long-lived connections and large transfers.
- Routing to the current primary conductor.

Preserve the worker-facing hostname in the `Host` header.  Forward the original protocol when TLS terminates at the proxy.  On standard ports, do not replace the external hostname with an internal `:5522` or `:5523` address.

Proxy all xyOps web traffic on the worker-facing hostname, including ordinary HTTP or HTTPS requests and WebSocket upgrades.  Restricting the proxy to installation traffic may allow the initial setup to succeed while upgrades, file transfers, or jobs fail later.

Also remember that the xyOps HTTP API, web interface, and WebSockets share the same listener.  Port-only firewall rules cannot turn `5522` into a worker-only service.  Use an application-aware proxy if strict separation is required.

## Main Configuration

Most installations only need a few settings at first: the conductor hostname, conductor list, human-facing URL, timezone, and worker connection settings described above.

The main configuration directory is `/opt/xyops/conf`.

Important files include:

| File | Purpose |
|------|---------|
| `config.json` | Main xyOps configuration. |
| `overrides.json` | Settings changed through the UI and generated values such as the secret key. |
| `masters.json` | Conductor hostnames when they are not supplied through `XYOPS_masters`. |

In Docker, bind the entire directory to persistent storage:

```sh
-v ./xyops-conf:/opt/xyops/conf
```

The directory can be empty on first launch.  xyOps copies in the default files automatically.

You can edit many settings under **Admin → Configuration**.  UI changes are written to `overrides.json`, leaving the base `config.json` intact.  See the [Configuration Reference](config.md) for every available property.

Keep this directory private and backed up.  It contains the `secret_key`, which is required to decrypt stored secrets and authenticate conductors and workers.

## Manual Install

Docker is the easiest installation method, but xyOps can also run directly on Linux, macOS, and other POSIX-compatible systems.

Install these prerequisites first:

- The current Node.js LTS release.
- NPM, normally included with Node.js.
- Compiler tools required by native NPM modules, such as `build-essential` and `python3-setuptools` on Ubuntu.

Then run the official installer as root:

```sh
curl -fsSL https://raw.githubusercontent.com/pixlcore/xyops/main/bin/install.js | sudo node
```

xyOps is installed under `/opt/xyops`.

To inspect and install a specific release manually:

```sh
sudo mkdir -p /opt/xyops
cd /opt/xyops
curl -L https://github.com/pixlcore/xyops/archive/v1.0.0.tar.gz | sudo tar zxvf - --strip-components 1
sudo npm install
sudo node bin/build.js dist
sudo bin/control.sh start
```

Replace `v1.0.0` with a version from the [release list](https://github.com/pixlcore/xyops/releases).  Use `main` only when you intentionally want an unreleased development revision.

To start xyOps automatically after reboot:

```sh
cd /opt/xyops
sudo npm run boot
```

On Linux this registers `xyops.service` with systemd.  After registration, use `systemctl` to start, stop, restart, and inspect the service.

Before adding remote workers, set the conductor hostname and verify it from a worker as described in [Before You Install](#before-you-install).

### Command Line

The [Command Line Guide](cli.md) documents service control, status, logs, debugging, configuration overrides, and administrative commands.

For a manual Linux installation registered with systemd, prefer:

```sh
sudo systemctl status xyops
sudo systemctl restart xyops
```

### Adding Conductors Manually

Do not add a second conductor until the first is healthy and shared external storage is configured.  Multiple conductors cannot use separate local databases or separate local file stores.

The high-level process is:

1. Configure [External Storage](#external-storage) shared by every conductor.
2. Stop the conductors while changing the cluster configuration.
3. Give each conductor a unique, stable, resolvable hostname.
4. Put every hostname in `XYOPS_masters` or each conductor's `masters.json`.
5. Copy the same `config.json` and `overrides.json` to the new conductor, then adjust only host-specific paths or settings.
6. Start the conductors and confirm that they discover each other.

A file-based conductor list looks like this:

```json
{
	"masters": [
		"xyops01.internal.mycompany.com",
		"xyops02.internal.mycompany.com"
	]
}
```

All conductors must share the same `secret_key`, storage configuration, conductor list, and cluster settings.  They must also reach one another by hostname.

For a public URL with automatic routing to the primary, see [Multi-Conductor with Nginx](#multi-conductor-with-nginx).

### Uninstall

Before uninstalling a conductor, [decommission its worker servers](servers.md#decommissioning-servers) or move them to another conductor cluster.

For Docker, stop and remove the container:

```sh
docker stop xyops-conductor-1
docker rm xyops-conductor-1
```

The persistent volume and bind-mounted directories remain.  Delete them only after confirming that you no longer need the data, configuration, logs, secrets, or backups.

For a manual installation:

```sh
cd /opt/xyops
sudo bin/control.sh stop
sudo npm run unboot
```

After saving anything you need, remove `/opt/xyops` using your normal system administration process.

## Environment Variables

Environment variables are convenient for Docker, orchestration, and automated provisioning.  Use the name `XYOPS_key`, where `key` is a command-line option or configuration property.

For nested configuration properties, separate each path segment with a double underscore.  For example, `XYOPS_satellite__config__port=443` sets the xySat connection port.

Values such as `true`, `false`, and numbers are converted to their corresponding JSON types.

Common examples are:

| Variable | Example | Purpose |
|----------|---------|---------|
| `XYOPS_hostname` | `xyops01.internal.mycompany.com` | Override the detected conductor hostname. |
| `XYOPS_masters` | `xyops01.internal.mycompany.com,xyops02.internal.mycompany.com` | Define the conductor list. |
| `XYOPS_base_app_url` | `https://xyops.mycompany.com` | Set the URL used for human-facing links. |
| `XYOPS_xysat_local` | `true` | Start a local xySat process with the conductor (for containers only). |
| `XYOPS_WebServer__port` | `80` | Change the built-in HTTP listener. |
| `XYOPS_WebServer__https_port` | `443` | Change the built-in HTTPS listener. |
| `XYOPS_satellite__config__host` | `xyops-workers.mycompany.com` | Send all workers to a static hostname. |
| `XYOPS_satellite__config__port` | `443` | Set the worker connection port. |
| `XYOPS_satellite__config__secure` | `true` | Select HTTPS and `wss://` for workers. |
| `XYOPS_Storage__Filesystem__base_dir` | `/data/xyops` | Override a deeply nested storage property. |
| `XYOPS_foreground` | `true` | Run the conductor in the foreground (for containers). |
| `XYOPS_echo` | `true` | Echo logs to standard output. |
| `XYOPS_color` | `true` | Colorize echoed logs. |

Environment variables work well for scalar values.  Use configuration files for arrays and large objects, such as preferred conductor lists or complex storage configuration.

## External Storage

The default single-conductor installation uses a hybrid of SQLite for structured data and the local filesystem for files.  This is a good fit for evaluation, home labs, and many small internal deployments.

Use [external storage](storage.md) when you need any of the following:

- Multiple conductors.
- Storage independent of a conductor host.
- Existing Redis, PostgreSQL, S3, or S3-compatible infrastructure.
- Production backup, recovery, and scaling policies managed outside the container.

For production multi-conductor deployments, use one shared data engine and one shared file store.  Common combinations are:

- Redis plus S3.
- PostgreSQL plus S3.
- Redis or PostgreSQL plus an S3-compatible service such as MinIO or RustFS.

Every conductor must point to the same shared storage.  Separate Docker volumes on separate conductors are not shared storage and can produce inconsistent cluster state.

Configure and test storage with one conductor before adding another.  See the [Storage Setup Guide](storage.md) for examples and engine-specific settings.

## Daily Backups

Back up both xyOps data and its configuration directory.  A data export does not include every local configuration file, and a database backup does not necessarily contain uploaded files.

To automate a portable data export:

1. Create an [API Key](api.md#api-keys).
2. Grant only the [`bulk_export`](privileges.md#bulk_export) privilege needed for this task.
3. Call the [`admin_export_data`](api.md#admin_export_data) API from a scheduled system job.

This example exports critical lists and ticket indexes:

```sh
curl -X POST "https://xyops.mycompany.com/api/app/admin_export_data" \
	-H "X-API-Key: YOUR_API_KEY_HERE" \
	-H "Content-Type: application/json" \
	-d '{"lists":"all","indexes":["tickets"]}' \
	-O -J
```

For a complete export, use:

```json
{"lists":"all","indexes":"all","extras":"all"}
```

Complete exports can be large and take time.  Review the API documentation to select the history, files, and extras appropriate for your retention policy.

Also back up `/opt/xyops/conf`, or the host directory mounted there.  Protect backups as sensitive data because they may contain configuration, encrypted secrets, API metadata, job output, uploads, and operational history.

Store backups away from the conductor and test restoration periodically.

### SQLite Backups

The default SQLite engine creates compressed daily database backups and keeps seven by default.  Configure this under [`Storage.SQLite`](config.md#storage-sqlite):

```json
"backups": {
	"enabled": true,
	"dir": "data/backups",
	"filename": "backup-[yyyy]-[mm]-[dd]-[hh]-[mi]-[ss].db",
	"compress": true,
	"keep": 7
}
```

SQLite stores structured data only in the default hybrid configuration.  These backups do not include files stored by the filesystem engine, such as job files, bucket objects, ticket attachments, or uploads.  Back up the full data directory or use a portable export when you need those items.

## Data Migration

Use the built-in export and import tools to move xyOps data, and copy the configuration directory separately.

The configuration directory at `/opt/xyops/conf` is especially important.

It contains the conductor settings and the `secret_key` used for secret encryption and node authentication.  Copy the original configuration before importing the original data.  If the destination starts with a different secret key, imported secrets may not decrypt and workers may fail to authenticate.

Recommended process:

1. On the old conductor, open **System** and export the desired data.
2. Keep the old conductor and export archive available until validation is complete.
3. Install xyOps on the destination, then stop it.
4. Copy the complete old `/opt/xyops/conf` directory to the destination.
5. Review only host-specific settings such as hostname, conductor list, paths, ports, certificates, and storage endpoints.
6. Start the destination and confirm that it loaded the copied configuration.
7. Import the data archive from **System**.
8. Verify users, API keys, secrets, events, workflows, plugins, schedules, buckets, files, workers, and history.
9. Test jobs and worker connectivity before retiring the old conductor.

For Docker, copy the host directory bound to `/opt/xyops/conf`.  Keep a separate backup of that directory even after the migration succeeds.

## Proxy Servers

The reverse proxies described earlier accept inbound browser or worker traffic.  This section covers a different concept: a forward proxy used by xyOps or job code for outbound requests.

### Outbound Forward Proxies

xyOps recognizes the common proxy environment variables:

- `HTTPS_PROXY`
- `HTTP_PROXY`
- `ALL_PROXY`
- `NO_PROXY`

Variable names may be upper or lower case.  A simple proxy used for both HTTP and HTTPS destinations can be configured with:

```sh
ALL_PROXY="http://company-proxy-server.com:8080"
```

Use `NO_PROXY` for destinations which should connect directly:

```sh
NO_PROXY="localhost,127.0.0.1,.internal.mycompany.com"
```

Supported proxy URL schemes include `http`, `https`, `socks`, `socks4`, `socks5`, and PAC-based schemes supported by the request library.

Set the variables wherever outbound requests run.  Conductor release checks need the conductor environment, while HTTP plugins or scripts running on workers may need the worker environment.

If a company proxy intercepts TLS, install its certificate authority on the conductor and workers instead of broadly disabling certificate verification.

## Air-Gapped Mode

Air-gapped mode restricts outbound requests made through supported xyOps request paths.  Configure it under [`airgap`](config.md#airgap):

```json
"airgap": {
	"enabled": true,
	"whitelist": [
		"127.0.0.1",
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"::1/128",
		"fd00::/8"
	],
	"blacklist": []
}
```

The rules propagate to connected workers for supported features such as the HTTP Plugin.  They do not control arbitrary networking performed by your own scripts, executables, or third-party plugin code.  Enforce operating-system and network-level controls as well.

For a fully restricted deployment:

- Allow the internal addresses required for conductors, workers, storage, proxies, SSO, DNS, and integrations.
- Disable conductor version checks with [`multi.enable_version_checks`](config.md#multi-enable_version_checks).
- Disable xySat version checks with [`satellite.enable_version_checks`](config.md#satellite-enable_version_checks).
- Disable [`client.outdated_badges`](config.md#client-outdated_badges).
- Disable [`marketplace.enabled`](config.md#marketplace-enabled).
- Store required container images in an approved local registry or image cache.
- Use local xySat packages as described below.
- Review every plugin and script for its own network behavior.

The full xyOps documentation is available inside the application, so operators do not need Internet access to read it.

### Offline Satellite Packages

xyOps can serve xySat installation and upgrade packages from one of its own storage buckets:

1. Obtain the signed xySat packages for each required operating system and architecture through xyOps Support.
2. Create a [Storage Bucket](buckets.md) in xyOps.
3. Upload files named `satellite-OS-ARCH.tar.gz`.
4. Set `satellite.bucket` to the bucket ID.
5. Install and upgrade workers normally from the xyOps UI.

The conductor serves the approved local package instead of downloading it from GitHub.

For Docker workers, pre-load or mirror the required image as well:

- [xyOps container](https://github.com/pixlcore/xyops/pkgs/container/xyops)
- [xySat container](https://github.com/pixlcore/xysat/pkgs/container/xysat)

Contact [xyOps Support](support.md) for signed offline packages and production air-gap planning.

## Multi-Conductor with Nginx

This is an advanced production layout.  Get a single conductor, its storage, and several workers running reliably before adding conductor redundancy.

The design uses:

- Two or more xyOps conductors with unique internal hostnames.
- Shared external storage used by every conductor.
- Nginx as the single human-facing TLS endpoint.
- The [xyOps Health Check](https://github.com/pixlcore/xyops-healthcheck) to keep Nginx pointed at the current primary.
- Direct worker connections to individual conductors, unless a worker-facing proxy is specifically required.

Example names:

- **Public URL:** `xyops.mycompany.com`
- **Conductor 1:** `xyops01.internal.mycompany.com`
- **Conductor 2:** `xyops02.internal.mycompany.com`

### Prerequisites

Before starting:

1. Configure and test shared [External Storage](#external-storage).
2. Configure DNS for the public URL and every conductor.
3. Obtain a TLS certificate and key for the public URL.
4. Give every conductor the same `secret_key`, storage settings, and conductor list.
5. Confirm that conductors and workers can resolve each internal conductor hostname.

### Start Nginx

The maintained [xyops-nginx](https://github.com/pixlcore/xyops-nginx) image includes Nginx and the primary health check:

```sh
docker run \
	--detach \
	--init \
	--name xyops-nginx \
	-e XYOPS_masters="xyops01.internal.mycompany.com,xyops02.internal.mycompany.com" \
	-e XYOPS_port="5522" \
	-v "$(pwd)/tls.crt:/etc/tls.crt:ro" \
	-v "$(pwd)/tls.key:/etc/tls.key:ro" \
	--restart unless-stopped \
	-p 443:443 \
	ghcr.io/pixlcore/xyops-nginx:latest
```

Change the certificate paths and conductor names.  Nginx listens on public port `443`; the health check contacts conductors on port `5522` and updates Nginx when the primary changes.

### Start Each Conductor

Run a conductor on each host.  This example is for the first one:

```sh
docker run \
	--detach \
	--init \
	--name xyops-conductor-1 \
	--hostname xyops01.internal.mycompany.com \
	-e XYOPS_masters="xyops01.internal.mycompany.com,xyops02.internal.mycompany.com" \
	-e XYOPS_base_app_url="https://xyops.mycompany.com" \
	-e TZ="America/Los_Angeles" \
	-v "$(pwd)/xyops01-conf:/opt/xyops/conf" \
	-v "$(pwd)/xyops01-logs:/opt/xyops/logs" \
	--restart unless-stopped \
	-p 5522:5522 \
	-p 5523:5523 \
	ghcr.io/pixlcore/xyops:latest
```

For the second conductor, change:

- The container name.
- The container hostname.
- The configuration and log directories.

Keep these identical:

- `XYOPS_masters`, including the order and spelling of every hostname.
- `XYOPS_base_app_url`.
- `secret_key`.
- Shared storage configuration.
- Cluster and preferred conductor settings.

Configuration directories are not shared filesystems.  Each conductor has its own copy, while all conductors point to the same external data and file stores.

### Worker Routing

By default, xySat connects directly to the internal conductor hostnames and handles conductor discovery and failover itself.  This avoids sending worker volume through the public Nginx endpoint.

If direct routing is impossible, use a worker-facing proxy and a static `satellite.config.host`.  The proxy must always route workers to the primary and meet every requirement in [Proxying xySat](#proxying-xysat).

For SSO in front of this layout, see the [SSO Guide](sso.md).  For capacity, storage, and rate-limit planning, see [Production Scaling](scaling.md).

## Secret Key Rotation

### Overview

Every conductor in a cluster shares one `secret_key`.  xyOps uses it to encrypt stored secrets, sign temporary tokens, authenticate conductor messages, and derive worker authentication tokens.

The UI automates rotation.  It generates a new cryptographically secure key, re-encrypts stored secrets, re-authenticates online workers, distributes the key to conductor peers, and saves it in `overrides.json`.

Rotation is intentionally disruptive to job scheduling.  Plan a maintenance window.

### Pre-Checks

Before starting:

- Confirm that every conductor is online and connected.
- Confirm that every worker is online.
- Wait for important jobs to finish.
- Confirm that configuration directories are writable and backed up.
- Tell operators that the scheduler will remain paused when rotation completes.

An offline conductor or worker cannot receive its update automatically and will require the recovery steps below.

### Rotation Process

1. Open **System** in the Admin section.
2. Start **Secret Key Rotation**.
3. xyOps pauses the scheduler, flushes queued jobs, and aborts active jobs.
4. The primary generates a new key and re-encrypts stored secrets.
5. Online workers receive new authentication tokens.
6. Conductor peers receive the new key securely.
7. Each conductor writes the key to `/opt/xyops/conf/overrides.json`.
8. Review the result, then resume the scheduler manually.

No restart or manual file edit is required when every node is online and writable.  Existing browser sessions and API keys remain valid.

### Offline Recovery

Use the matching procedure for any node which missed rotation.  Treat the current secret key and worker authentication tokens as sensitive values.

#### Re-authenticate an Offline Worker Server

You need:

- The worker `server_id` from its local `config.json` or server history.
- The current `secret_key` from the primary conductor's `/opt/xyops/conf/overrides.json`.

The worker token is the SHA-256 hex digest of `SERVER_ID + SECRET_KEY`, with no separator.  For example:

```sh
printf "%s" "SERVER_IDSECRET_KEY" | openssl dgst -sha256 -r | awk '{print $1}'
```

On the worker, update `auth_token` in `/opt/xyops/satellite/config.json`.

xySat reloads its configuration and should reconnect shortly.  Check its logs if it remains offline.

#### Update an Offline Conductor

1. Obtain the current `secret_key` securely from the primary conductor.
2. Stop the offline conductor.
3. Update `secret_key` in `/opt/xyops/conf/overrides.json`.
4. Confirm that the remaining cluster and shared storage settings match.
5. Start the conductor and verify that it rejoins as a peer.

Never send the secret key through an issue, public chat, or ordinary log collection.

### Best Practices

- Rotate during a planned maintenance window.
- Keep conductors and workers online during rotation.
- Back up configuration before rotating.
- Restrict filesystem and SSH access to conductor configuration.
- Verify stored secrets and worker connectivity after rotation.
- Resume the scheduler only after reviewing the rotation result.
- Include key rotation in your regular security program.

## Preferred Conductors

By default, conductor leadership is sticky.  Once a conductor becomes primary, it remains primary until it stops, restarts, or fails.  A recovered conductor does not automatically take leadership back simply because its hostname sorts earlier.

Preferred Conductors let you define an explicit priority order.  The cluster can fail over to any available conductor, then return leadership to a higher-priority preferred conductor after it becomes stable again.

### Active Primary Handoffs

When the preferred list is non-empty, the primary checks for a higher-ranked eligible peer once per minute.

A peer is eligible when:

- It appears higher in the preferred ranking.
- It is online and connected.
- Its connection is at least `relinquish_min_age` seconds old.
- No internal maintenance job blocks the handoff.
- If `relinquish_wait_jobs` is enabled, ordinary active jobs have finished.

The minimum age prevents an unstable peer from immediately triggering another election.  The default is `60` seconds.

### Election Ranking

Without a preferred list, online conductors are ranked alphabetically by hostname during an election.

With this configuration:

```json
[
	"xyops03.internal.mycompany.com",
	"xyops02.internal.mycompany.com"
]
```

the order is:

1. `xyops03.internal.mycompany.com`
2. `xyops02.internal.mycompany.com`
3. Any unlisted conductor, sorted alphabetically

You do not need to list every conductor.  Unlisted conductors remain valid failover candidates.

### Preferred Config

Edit these settings under **Admin → Configuration**, or in the [`multi`](config.md#multi) object:

```json
"multi": {
	"preferred_conductors": [
		"xyops03.internal.mycompany.com",
		"xyops02.internal.mycompany.com"
	],
	"relinquish_min_age": 60,
	"relinquish_wait_jobs": true
}
```

| Property | Meaning |
|----------|---------|
| [`multi.preferred_conductors`](config.md#multi-preferred_conductors) | Hostnames ordered from highest to lowest priority. |
| [`multi.relinquish_min_age`](config.md#multi-relinquish_min_age) | Minimum peer connection age before handoff. |
| [`multi.relinquish_wait_jobs`](config.md#multi-relinquish_wait_jobs) | Wait for active jobs before handing off leadership. |

> [!IMPORTANT]
> Every conductor must use the same preferred list and relinquish settings.  UI changes are synchronized across the cluster.  If you edit files directly, update every conductor consistently.
