# Self-Hosting

## Overview

This guide covers self-hosting xyOps on your own infrastructure.  However, please note that for live production installs, it is dangerous to go alone.  While we provide all necessary documentation here, we strongly recommend our [Enterprise Plan](https://xyops.io/pricing). This gives you access to our white-glove onboarding service, where our team will guide you through every step, validate your configuration, and ensure your integration is both secure and reliable.  This also gets you priority ticket support, and live chat support from a xyOps engineer.

## Before You Install

Before installing xyOps, it is important to decide how browsers, worker servers, and conductor servers will reach each other.  Most installation problems come from using a hostname that only works inside Docker, or from confusing the human-facing xyOps URL with the address used by xySat.

### Conductor Hostname

Every xyOps conductor has a hostname which acts as its permanent identity in the cluster.  By default, xyOps uses the hostname reported by the operating system.  In Docker, this is the **container hostname**, not the Docker container name and not necessarily the hostname of the Docker host.

The conductor hostname must be stable, resolve to an IP address, and be reachable from every worker server and every other conductor.  You can set it in either of these ways:

- With Docker, use `--hostname` or the Compose `hostname` property.
- On any installation, set the `XYOPS_hostname` environment variable to override the detected hostname.

For a single-conductor installation, set `XYOPS_masters` to this exact same hostname.  For multiple conductors, list every conductor hostname in `XYOPS_masters`, separated by commas.

> [!IMPORTANT]
> Do not use a sample hostname such as `xyops01.internal.mycompany.com` unless you have configured it in DNS, Tailscale, `/etc/hosts`, or another name service used by all of your workers.  A Docker network alias which only resolves from neighboring containers is not sufficient for workers elsewhere on your network.

Conductor hostnames should be treated as permanent infrastructure names.  Changing one later requires updating the conductor cluster and may require updating worker configuration.

### The Important URLs and Settings

xyOps has several settings which contain similar words such as "host", "URL", and "base".  They serve different purposes and should not be made identical unless that matches your network design.

| Name | Used By | Purpose |
|------|---------|---------|
| Conductor hostname | Conductors and xySat | The permanent network identity of one conductor, such as `xyops01.internal.mycompany.com`.  By default, xySat connects directly to this hostname. |
| [`base_app_url`](config.md#base_app_url) | People and notifications | The URL people should open, such as `https://xyops.mycompany.com`.  It is used to create links in emails, alerts, tickets, and web hooks.  It does **not** control where xySat connects. |
| [`WebServer.port`](config.md#webserver-port) | Browsers, APIs, and xySat | The built-in HTTP and `ws://` listener.  The default is `5522`. |
| [`WebServer.https_port`](config.md#webserver-https_port) | Browsers, APIs, and xySat | The built-in HTTPS and `wss://` listener.  The default is `5523`. |
| [`satellite.config`](config.md#satellite-config) | xySat | The connection and runtime settings distributed to workers, including `host` or `hosts`, `port`, and `secure`. |
| [`satellite.base_url`](config.md#satellite-base_url) | The conductor | The upstream software release location from which the conductor downloads xySat packages.  Despite its name, this is not the xyOps application URL and is not the address workers connect to. |

For example, it is perfectly valid to use all of the following at the same time:

- **Conductor hostname:** `xyops01.internal.mycompany.com`
- **Human-facing URL:** `https://xyops.mycompany.com`
- **xySat connection:** `ws://xyops01.internal.mycompany.com:5522`

In this example, browsers use the public URL through a reverse proxy, while xySat connects directly to the internal conductor hostname.

### Ports 5522 and 5523

The default ports are shared listeners, not dedicated xySat ports:

| Port | Protocols | What It Serves |
|------|-----------|----------------|
| `5522` | HTTP and `ws://` | Web interface, HTTP API, xySat bootstrap downloads, and WebSocket connections. |
| `5523` | HTTPS and `wss://` | The same services over TLS. |

For the default non-TLS xySat configuration, workers use port `5522` with `secure` set to `false`.  To connect xySat directly to the built-in TLS listener, set the satellite port to `5523` and `secure` to `true`.

Because ordinary HTTP and WebSocket traffic share each listener, opening port `5522` to a worker network does not expose a WebSocket-only service.  Clients on that network can also reach the web interface and HTTP API on that port.  If you require application-level separation, use a reverse proxy or another application-aware network control.  See [Reverse Proxies and Worker Connections](#reverse-proxies-and-worker-connections).

### Network Traffic Direction

xySat initiates its connection to xyOps.  The conductor does not open outbound connection to worker servers.

Plan firewall rules for these traffic paths:

- **Browsers to xyOps:** Browsers connect to `base_app_url`, often through a reverse proxy on port `443`.
- **Workers to conductors:** Each worker makes outbound HTTP or HTTPS requests during installation, then opens a persistent outbound WebSocket connection.  Allow the worker to reach the configured conductor hostname and port.
- **Conductors to conductors:** Every conductor must reach every other conductor hostname and configured port.
- **Conductor to release services:** Unless you use [Air-Gapped Mode](#air-gapped-mode), the conductor downloads and caches xySat release packages from `satellite.base_url`.

### Common Network Layouts

| Layout | `base_app_url` | xySat Connection | Worker Firewall Requirement |
|--------|----------------|------------------|-----------------------------|
| Direct, without TLS | `http://xyops01.internal.mycompany.com:5522` | `ws://xyops01.internal.mycompany.com:5522` | TCP `5522` to each conductor. |
| Direct, with built-in TLS | `https://xyops01.internal.mycompany.com:5523` | `wss://xyops01.internal.mycompany.com:5523` | TCP `5523` to each conductor. |
| Proxy for people only | `https://xyops.mycompany.com` | Directly to each conductor on port `5522` or `5523` | The direct conductor port.  Workers do not need the public UI port. |
| Proxy for people and workers | `https://xyops.mycompany.com` | A dedicated worker-facing proxy hostname, usually on port `443` | TCP `443` to the proxy.  The proxy must support WebSockets and xySat HTTP traffic. |

The simplest and most scalable production layout is usually a public reverse proxy for people, plus direct connections from workers to the individual conductor hostnames.  A worker-facing proxy is useful when direct routing is impossible, but requires additional care.

### Test From a Worker First

Before installing xySat, log into one of the intended worker servers and verify the exact hostname and port it will use.  For a default non-TLS setup:

```sh
getent hosts xyops01.internal.mycompany.com
curl -fsS http://xyops01.internal.mycompany.com:5522/api/app/ping
```

The first command must resolve the conductor hostname, and the second must receive a successful response.  On systems without `getent`, use the local DNS lookup tool provided by the operating system.  If either test fails, fix DNS, routing, or firewall access before generating an xySat installer.

## Quick-Start

To start quickly and just get xyOps up and running with a single conductor server, you can use the following Docker command (but **please** see the notes below, as they are extremely important):

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
	-v xy-data:/opt/xyops/data \
	-v ./xyops01-conf:/opt/xyops/conf \
	-v ./xyops01-logs:/opt/xyops/logs \
	-v /var/run/docker.sock:/var/run/docker.sock \
	--restart unless-stopped \
	-p 5522:5522 \
	-p 5523:5523 \
	ghcr.io/pixlcore/xyops:latest
```

Here it is as a docker compose file:

```yaml
services:
  xyops01:
    image: ghcr.io/pixlcore/xyops:latest
    container_name: xyops-conductor-01
    hostname: xyops01.internal.mycompany.com

    init: true
    restart: unless-stopped

    environment:
      XYOPS_xysat_local: "true"
      XYOPS_masters: "xyops01.internal.mycompany.com"
      XYOPS_base_app_url: "http://xyops01.internal.mycompany.com:5522"
      TZ: America/Los_Angeles

    volumes:
      - xy-data:/opt/xyops/data
      - ./xyops01-conf:/opt/xyops/conf
      - ./xyops01-logs:/opt/xyops/logs
      - /var/run/docker.sock:/var/run/docker.sock

    ports:
      - "5522:5522"
      - "5523:5523"

volumes:
  xy-data:
```

Please change `./xyops01-conf` and `./xyops01-logs` to suitable locations for the xyOps configuration and logs directories to live on the host machine.

Once the hostname resolves on your network, open `http://xyops01.internal.mycompany.com:5522/` in your browser (see [TLS](#tls) below for HTTPS setup).  You can use `http://localhost:5522/` as a local smoke test from the Docker host, but do not use `localhost` as the permanent `base_app_url`, because links containing `localhost` will point each user back to their own computer.

A default administrator account will be created with username `admin` and password `admin`.  This will create a Docker volume (`xy-data`) to persist the xyOps database, which by default is a hybrid of a SQLite DB and the filesystem itself for file storage.

A few notes:

- **Important:** Please change the sample `xyops01.internal.mycompany.com` hostname to something that actually resolves and is addressable on your network.  **Without this, many features will not work properly.**
	- Also, you must change the `XYOPS_masters` environment variable to match this, as this defines your conductor "cluster" (in this case a cluster of one).
	- Change `XYOPS_base_app_url` to the URL that people will actually use to open xyOps.  For this direct quick-start layout, it uses the same conductor hostname and port.  If you later add a reverse proxy, change it to the proxy URL instead.
- The Docker `--hostname` setting establishes the conductor hostname.  As an alternative, you can override the detected hostname with `XYOPS_hostname`.  You normally only need one of these mechanisms.
- Change the `TZ` environment variable to your local timezone, for proper midnight log rotation and daily stat resets.
- The `XYOPS_xysat_local` environment variable causes xyOps to launch [xySat](#satellite) in the background, in the same container.  This is so you can start running jobs right away -- it is great for testing and home labs, but *not recommended for production*.
- The `XYOPS_masters` environment variable is how you define a cluster of multiple conductor servers (comma-separated hostnames).  In this case just set it to the hostname of the primary.
- If you plan on using the container long term, please make sure to [rotate the secret key](#secret-key-rotation) regularly (e.g. every few months).
- The `/var/run/docker.sock` bind is optional, and allows xyOps to launch its own containers (i.e. for the [Docker Plugin](plugins.md#docker-plugin), and the [Plugin Marketplace](marketplace.md)).

Before adding worker servers, run the checks in [Test From a Worker First](#test-from-a-worker-first).  See [Adding Servers](servers.md#adding-servers) for installation options and automated provisioning.

### Main Configuration

The xyOps main configuration file is located at `/opt/xyops/conf/config.json`, but there are other useful files in the `/opt/xyops/conf` directory as well.  For e.g. if any configuration properties are updated via the UI, they are written to an `/opt/xyops/conf/overrides.json` file.  If you intend to use the Docker container long term, it is best to map the entire `/opt/xyops/conf` directory.  You can do this as a volume, or bind mount it to a host directory (recommended):

```
-v ./xyops01-conf:/opt/xyops/conf
```

xyOps will automatically copy over all default configuration files on first launch.

See the [Configuration Guide](config.md) for full details on how to customize the `config.json` file.

## Manual Install

This section covers manually installing xyOps on a server (outside of Docker).

Please note that the xyOps conductor currently only works on POSIX-compliant operating systems, which basically means Unix/Linux and macOS.  You'll also need to have [Node.js](https://nodejs.org/en/download/) pre-installed on your server.  Please note that we **strongly suggest that you install the LTS version of Node.js**.  While xyOps should work on the "current" release channel, LTS is more stable and more widely tested.  See [Node.js Releases](https://nodejs.org/en/about/releases/) for details.

xyOps also requires NPM to be preinstalled.  Now, this is typically bundled with and automatically installed with Node.js, but if you install Node.js by hand, you may have to install NPM yourself.  You will likely also need compiler tools (i.e. `apt-get install build-essential python3-setuptools` on Ubuntu).

Once you have Node.js and NPM installed, type this as root:

```sh
curl -s https://raw.githubusercontent.com/pixlcore/xyops/main/bin/install.js | node
```

This will install the latest stable release of xyOps and all of its dependencies under: `/opt/xyops/`

If you'd rather install it manually (or install as a non-root user), here are the raw commands:

```sh
mkdir -p /opt/xyops && cd /opt/xyops
curl -L https://github.com/pixlcore/xyops/archive/v1.0.0.tar.gz | tar zxvf - --strip-components 1
npm install
node bin/build.js dist
bin/control.sh start
```

Replace `v1.0.0` with the desired xyOps version from the [official release list](https://github.com/pixlcore/xyops/releases), or `main` for the head revision (unstable).

If you would like xyOps to automatically start itself on server reboot, issue this command:

```sh
cd /opt/xyops
npm run boot
```

**For Linux users:** Once you run `npm run boot`, which registers xyOps as a Systemd service, you should always start / stop it using the proper `systemctl` commands.  The service name is `xyops.service`.

### Command Line

See our [Command Line Guide](cli.md) for controlling the xyOps service via command-line.

### Adding Conductors Manually

When you manually install xyOps, it creates a cluster of one, and promotes itself to primary.  To add backup conductors, follow these instructions.

First, for multi-conductor setups, **you must have shared external storage**.  For live production, we recommend a Hybrid storage setup using Redis or Postgres for JSON data, plus S3 or an S3-compatible service for files.  See [Storage Setup](storage.md) for details.

Once you have external storage setup and working, stop the xyOps service, and edit the `/opt/xyops/conf/masters.json` file:

```json
{
	"masters": [
		"xyops01.internal.mycompany.com"
	]
}
```

**Note:** If you are using Docker, this is likely specified via the `XYOPS_masters` environment variable instead (which is split on comma and written out to the `masters.json` file on boot).  So you can just change the environment variable and not have to edit the file manually.

Add the new server hostname to the `masters` array in the `masters.json` file (or as a comma-separated list in `XYOPS_masters` for Docker setups).  Remember, both servers need to be able to reach each other via their hostnames.

Then, install the software onto the new server, and copy over the following files before starting the service:

```
/opt/xyops/conf/config.json
/opt/xyops/conf/overrides.json
/opt/xyops/conf/masters.json
```

Then finally, start the service on both servers.  They should self-negotiate and one will be promoted to primary after 10 seconds (whichever hostname sorts first alphabetically).

Note that conductor server hostnames **cannot change**.  If they do, you will need to update the `/opt/xyops/conf/masters.json` file on all servers and restart everything (or, if using Docker, change all the `XYOPS_masters` environment variables on all your conductor containers).

For fully transparent auto-failover using a single user-facing hostname, see [Multi-Conductor with Nginx](#multi-conductor-with-nginx) below.

### Uninstall

To uninstall xyOps, simply stop the service and delete the `/opt/xyops` directory.

```sh
cd /opt/xyops
bin/control.sh stop
npm run unboot # deregister as system startup service
rm -rf /opt/xyops
cd -
```

Make sure you [decommission your servers](servers.md#decommissioning-servers) first.

## Environment Variables

xyOps supports a special environment variable syntax, which can specify command-line options as well as override any configuration settings.  The variable name syntax is `XYOPS_key` where `key` is one of several command-line options (see table below) or a JSON configuration property path.  These can come in handy for automating installations, and using container systems.  

For overriding configuration properties by environment variable, you can specify any top-level JSON key from `config.json`, or a *path* to a nested property using double-underscore (`__`) as a path separator.  For boolean properties, you can use `true` or `false` strings, and xyOps will convert them.  Here is an example of some of the possibilities available:

| Variable | Sample Value | Description |
|----------|--------------|-------------|
| `XYOPS_foreground` | `true` | Run xyOps in the foreground (no background daemon fork). |
| `XYOPS_echo` | `true` | Echo the event log to the console (STDOUT), use in conjunction with `XYOPS_foreground`. |
| `XYOPS_color` | `true` | Echo the event log with color-coded columns, use in conjunction with `XYOPS_echo`. |
| `XYOPS_hostname` | `xyops01.internal.mycompany.com` | Override the conductor hostname detected from the operating system or container. |
| `XYOPS_masters` | `xyops01.internal.mycompany.com` | Define the conductor hostnames in the cluster as a comma-separated list. |
| `XYOPS_base_app_url` | `http://xyops.mycompany.com` | Override the [base_app_url](config.md#base_app_url) configuration property. |
| `XYOPS_satellite__config__host` | `xyops-workers.mycompany.com` | Override the static hostname used by all xySat workers.  Omit this to use the normal conductor list. |
| `XYOPS_satellite__config__port` | `443` | Set the port used for xySat HTTP and WebSocket traffic. |
| `XYOPS_satellite__config__secure` | `true` | Use HTTPS and `wss://` for xySat traffic. |
| `XYOPS_email_from` | `xyops@mycompany.com` | Override the [email_from](config.md#email_from) configuration property. |
| `XYOPS_WebServer__port` | `80` | Override the `port` property *inside* the [WebServer](config.md#webserver) object. |
| `XYOPS_WebServer__https_port` | `443` | Override the `https_port` property *inside* the [WebServer](config.md#webserver) object. |
| `XYOPS_Storage__Filesystem__base_dir` | `/data/xyops` | Override the `base_dir` property *inside* the [Filesystem](config.md#storage-filesystem) object *inside* the [Storage](config.md#storage) object. |

Almost every [configuration property](config.md) can be overridden using this environment variable syntax.  The only exceptions are things like arrays, e.g. [log_columns](config.md#log_columns).

## Daily Backups

Here is how you can generate daily backups of critical xyOps data, regardless of your backend storage engine.  First, create an [API Key](api.md#api-keys) and grant it the [bulk_export](privileges.md#bulk_export) privilege (this is required to use the [admin_export_data](api.md#admin_export_data) API).  You can then request a backup using a [curl](https://curl.se/) command like this:

```sh
curl -X POST "https://xyops.mycompany.com/api/app/admin_export_data" \
	-H "X-API-Key: YOUR_API_KEY_HERE" -H "Content-Type: application/json" \
	-d '{"lists":"all","indexes":["tickets"]}' -O -J
```

This will save the backup as a `.txt.gz` file in the current directory named using this filename pattern:

```
xyops-data-export-YYYY-MM-DD-UNIQUEID.txt.gz
```

Please note that this example will only export **critical** data, and is not a full backup (notably absent is job history, alert history, snapshot history, server history, and activity log).  To backup *everything*, change the JSON in the curl request to: `{"lists":"all","indexes":"all","extras":"all"}`.  Note that this can take quite a while and produce a very large file depending on your xyOps database size.  To limit what exactly gets included in the backup, consult the [admin_export_data](api.md#admin_export_data) API docs.

### SQLite Backups

If you are using the stock storage configuration (SQLite + Filesystem), then xyOps will keep 7 days worth of compressed daily SQLite backups by default.  These are mainly for disaster recovery purposes.  You can configure or disable the backups in the [Storage.SQLite](config.md#storage-sqlite) configuration object:

```json
"SQLite": {
	"base_dir": "data",
	"filename": "sqlite.db",
	"pragmas": {
		"auto_vacuum": 0,
		"cache_size": -100000,
		"journal_mode": "WAL"
	},
	"cache": {
		"enabled": true,
		"maxItems": 100000,
		"maxBytes": 104857600
	},
	"backups": {
		"enabled": true,
		"dir": "data/backups",
		"filename": "backup-[yyyy]-[mm]-[dd]-[hh]-[mi]-[ss].db",
		"compress": true,
		"keep": 7
	}
}
```

Note that SQLite only stores data, not "files", under the default hybrid SQLite + Filesystem configuration.  So these backups are mainly for recovering from critical disaster situations like running out of disk space (where the DB may be corrupted).  They are not "complete" backups, as they do not contain job files, bucket files, ticket attachments, user uploads, etc.

## TLS

The xyOps built-in web server ([pixl-server-web](https://github.com/jhuckaby/pixl-server-web)) supports TLS, but you will need a valid certificate whose hostname is trusted by browsers and workers.  Please read the following guide for setup instructions:

[Let's Encrypt / ACME TLS Certificates](https://github.com/jhuckaby/pixl-server-web#lets-encrypt--acme-tls-certificates)

When xySat connects directly to the built-in TLS listener, configure both of these [satellite.config](config.md#satellite-config) properties:

```json
"port": 5523,
"secure": true
```

Also set `base_app_url` to the HTTPS URL that people should use.  Changing `base_app_url` does not change the xySat connection settings.

Alternatively, you can set up a reverse proxy in front of xyOps and terminate TLS there.  The next section explains how this affects workers.

## Reverse Proxies and Worker Connections

A reverse proxy can be used in two different ways:

1. **Proxy browsers only:** People use a public URL such as `https://xyops.mycompany.com`, while xySat connects directly to each internal conductor hostname.  This is the recommended layout when workers can route to the conductors.
2. **Proxy browsers and xySat:** Workers also connect through a proxy because they cannot route directly to the conductors.  This requires a worker-facing hostname and full support for both HTTP and WebSocket traffic.

### Proxying Browsers Only

Set `base_app_url` to the public proxy URL:

```sh
XYOPS_base_app_url="https://xyops.mycompany.com"
```

Keep the conductor hostname set to its stable internal name, such as `xyops01.internal.mycompany.com`.  Unless you override it, generated xySat installers will use the conductor hostname and the port and protocol from `satellite.config`.  Workers do not need access to the public UI port when they connect directly to the conductor.

For example:

- **Browser:** `https://xyops.mycompany.com`
- **xySat:** `ws://xyops01.internal.mycompany.com:5522`

This separation is intentional.  `base_app_url` is for human-facing links, while the conductor hostname is the default worker connection address.

### Proxying xySat

If workers must enter through a proxy, set the optional `host` property inside [satellite.config](config.md#satellite-config).  This static host overrides the normal conductor `hosts` array for every worker managed by the conductor.

For example, these Docker environment variables direct all workers through `xyops-workers.mycompany.com` on port `443`:

```sh
-e XYOPS_satellite__config__host="xyops-workers.mycompany.com" \
-e XYOPS_satellite__config__port="443" \
-e XYOPS_satellite__config__secure="true"
```

The proxy must:

- Accept HTTP or HTTPS requests used for xySat installation, configuration, upgrades, package downloads, and job-related file transfers.
- Accept persistent WebSocket upgrades on the same worker-facing hostname and port.
- Preserve the worker-facing hostname in the `Host` header rather than replacing it with the internal backend hostname.  On standard ports, do not append an internal port such as `5522` or `5523`.
- Forward the original protocol, typically using `X-Forwarded-Proto` when TLS terminates at the proxy.
- Use timeouts long enough for persistent WebSockets and large transfers.
- Route workers to the current primary conductor when multiple conductors are present.

Do not configure a worker-facing proxy to allow only the initial installer URL.  The first installation may succeed while upgrades, file transfers, or job features fail later.

> [!IMPORTANT]
> A `host` value inside `satellite.config` takes precedence over the conductor-generated `hosts` array.  In a multi-conductor cluster, only use this setting when the static hostname points to a proxy or load balancer which can route workers to the current primary.  Otherwise, the normal `hosts` array provides direct conductor discovery and failover.

## Multi-Conductor with Nginx

For a load balanced multi-conductor setup with Nginx w/TLS, please read this section.  This is a complex setup, and requires advanced knowledge of all the components used.  Let me recommend our [Enterprise Plan](https://xyops.io/pricing) here, as we can set all this up for you.  Now, the way this configuration works is as follows:

- [Nginx](https://nginx.org/) sits in front, and handles TLS termination, as well as routing requests to various backends.
- Nginx handles xyOps multi-conductor using an embedded [Health Check Daemon](https://github.com/pixlcore/xyops-healthcheck) which runs in the same container.
	- The health check keeps track of which conductor server is primary, and dynamically reconfigures and hot-reloads Nginx as needed.
	- We maintain our own custom Nginx docker image for this (shown below), or you can [build your own from source](https://github.com/pixlcore/xyops-nginx/blob/main/Dockerfile).

A few prerequisites for this setup:

- For multi-conductor setups, **you must have shared external storage**.  For live production, we recommend a Hybrid storage setup using Redis or Postgres for JSON data, plus S3 or an S3-compatible service for files.  See [Storage Setup](storage.md) for details.
- You will need a custom domain configured and TLS certs created and ready to attach.
- You have your xyOps configuration file customized and ready to go ([config.json](https://github.com/pixlcore/xyops/blob/main/sample_conf/config.json)) (see below).

For the examples below, we'll be using the following domain placeholders:

- `xyops.mycompany.com` - User-facing domain which should route to Nginx / SSO.
- `xyops01.internal.mycompany.com` - Internal domain for conductor server #1.
- `xyops02.internal.mycompany.com` - Internal domain for conductor server #2.

The reason why the conductor servers each need their own unique (internal) domain name is because of how the multi-conductor system works.  Each conductor server needs to be individually addressable, and reachable by all of your worker servers in your org.  Worker servers don't know or care about Nginx -- they contact conductors directly, and have their own auto-failover system.  Also, worker servers use a persistent WebSocket connection, and can send a large amount of traffic, depending on how many worker servers you have and how many jobs you run.  For these reasons, it's better to have worker servers connect the conductors directly, especially at production scale.

That being said, you *can* configure your worker servers to connect through the Nginx front door if you want.  This can be useful if you have worker servers in another network or out in the wild, but it is not recommended for most setups.  To do this, please see [Overriding The Connect URL](hosting.md#overriding-the-connect-url) in our self-hosting guide.

Here is a docker command for running Nginx:

```sh
docker run \
	--detach \
	--init \
	--name xyops-nginx \
	-e XYOPS_masters="xyops01.internal.mycompany.com,xyops02.internal.mycompany.com" \
	-e XYOPS_port="5522" \
	-v "$(pwd)/tls.crt:/etc/tls.crt:ro" \
	-v "$(pwd)/tls.key:/etc/tls.key:ro" \
	-p 443:443 \
	ghcr.io/pixlcore/xyops-nginx:latest
```

Here it is as a docker compose file:

```yaml
services:
  nginx:
    image: ghcr.io/pixlcore/xyops-nginx:latest
    init: true
    environment:
      XYOPS_masters: xyops01.internal.mycompany.com,xyops02.internal.mycompany.com
      XYOPS_port: 5522
    volumes:
      - "./tls.crt:/etc/tls.crt:ro"
      - "./tls.key:/etc/tls.key:ro"
    ports:
      - "443:443"
```

Let's talk about the Nginx setup.  We are pulling in our own Docker image here ([xyops-nginx](https://github.com/pixlcore/xyops-nginx)).  This is a wrapper around the official Nginx docker image, but it includes our [xyOps Health Check](https://github.com/pixlcore/xyops-healthcheck) daemon.  The health check monitors which conductor server is currently primary, and dynamically reconfigures Nginx on-the-fly as needed (so Nginx always routes to the current primary server only).  The image also comes with a fully preconfigured Nginx.  To use this image you will need to provide:

- Your TLS certificate files, named `tls.crt` and `tls.key`, which are bound to `/etc/tls.crt` and `/etc/tls.key`, respectively.
- The list of xyOps conductor server domain names, as a CSV list in the `XYOPS_masters` environment variable (used by health check).

Once you have Nginx running, we can fire up the xyOps backend.  This is documented separately as you'll usually want to run these on separate servers.  Here is the multi-conductor configuration as a single Docker run command:

```sh
docker run \
	--detach \
	--init \
	--name xyops-conductor-1 \
	--hostname xyops01.internal.mycompany.com \
	-e XYOPS_masters="xyops01.internal.mycompany.com,xyops02.internal.mycompany.com" \
	-e XYOPS_base_app_url="https://xyops.mycompany.com" \
	-e TZ="America/Los_Angeles" \
	-v "./xyops01-conf:/opt/xyops/conf" \
	-v "./xyops01-logs:/opt/xyops/logs" \
	-v "/var/run/docker.sock:/var/run/docker.sock" \
	--restart unless-stopped \
	-p 5522:5522 \
	-p 5523:5523 \
	ghcr.io/pixlcore/xyops:latest
```

And here it is as a docker compose file:

```yaml
services:
  xyops1:
    image: ghcr.io/pixlcore/xyops:latest
    container_name: xyops-conductor-01
    hostname: xyops01.internal.mycompany.com # change this per conductor server
    init: true
    environment:
      XYOPS_masters: xyops01.internal.mycompany.com,xyops02.internal.mycompany.com
      XYOPS_base_app_url: https://xyops.mycompany.com
      TZ: America/Los_Angeles
    volumes:
      - "./xyops01-conf:/opt/xyops/conf"
      - "./xyops01-logs:/opt/xyops/logs"
      - "/var/run/docker.sock:/var/run/docker.sock"
    ports:
      - "5522:5522"
      - "5523:5523"
```

For additional conductor servers you can simply duplicate the command and change the hostname.

A few things to note here:

- We're using our official xyOps Docker image, but you can always [build your own from source](https://github.com/pixlcore/xyops/blob/main/Dockerfile).
- All conductor server hostnames need to be listed in the `XYOPS_masters` environment variable, comma-separated.
- All conductor servers need to be able to route to each other via their hostnames, so they can self-negotiate and hold elections.
- `XYOPS_base_app_url` should be set to the public Nginx URL, so links generated for users point to the proxy rather than an individual conductor.
- The timezone (`TZ`) should be set to your company's main timezone, so things like midnight log rotation and daily stat resets work as expected.
- The `/var/run/docker.sock` bind allows xyOps to launch its own containers (i.e. for the [Plugin Marketplace](marketplace.md)).
- The `./xyops01-conf` path should be changed to a location on the host where you want to store the xyOps configuration directory.
	- xyOps will automatically populate this directory on first container launch.
	- Each conductor needs a unique directory for config (they cannot be shared).
	- See the [xyOps Configuration Guide](config.md) for details on how to customize the `config.json` file in this directory.
- The `./xyops01-logs` path should be changes to a location on the host where you want to store the xyOps logs directory.

## External Storage

For using an external storage system, you have [several to choose from](storage.md).  For live production multi-conductor setups, we currently recommend **Redis + S3** or **Postgres + S3** via the Hybrid storage engine.  The S3 side can be AWS S3 or an S3-compatible service such as MinIO or RustFS.

For more details, see the [Storage Setup Guide](storage.md).

## Satellite

**xyOps Satellite ([xySat](https://github.com/pixlcore/xysat))** is a companion to the xyOps system.  It is both a job runner, and a data collector for server monitoring and alerting.  xySat is designed to be installed on *all* of your servers, so it is lean, mean, and has zero dependencies.

For instructions on how to install xySat, see [Adding Servers](servers.md#adding-servers).

### What The Installer Does

The one-line command generated by **Add Server** is a bootstrap process, not just a package download.  The worker uses the generated conductor URL to:

1. Download a small shell or PowerShell installer.
2. Test that it can reach the conductor.
3. Download the correct xySat package for its operating system and CPU architecture.
4. Download a generated `config.json` containing its server ID, authentication token, conductor connection information, and any initial server options.
5. Install and start xySat as a system service.
6. Open a persistent outbound WebSocket connection to xyOps.

When you run the command exactly as generated, the bootstrap downloads and the resulting WebSocket connection use the host, port, and security settings selected for xySat.  With the default configuration, this is the conductor hostname on port `5522`.  Manually changing the installer URL can send the bootstrap downloads through a different route, even though the generated worker configuration still contains the centrally managed xySat connection settings.

The generated `t=` bootstrap token authenticates the installation requests and expires after 24 hours.  Treat the entire installer URL as sensitive, do not post it publicly, and generate a new one if it has been exposed.

### Satellite Configuration

xySat is configured automatically by the xyOps conductor.  The [satellite.config](config.md#satellite-config) object is sent to each worker after it connects and authenticates, allowing you to centrally manage xySat settings across the fleet.

During the initial installation, xyOps adds a `hosts` array containing the current conductor hostname.  After xySat connects, the current primary sends the complete conductor list.  xySat can then discover the primary and fail over when a conductor becomes unavailable.

Here is the default centrally managed configuration.  The generated `hosts`, `server_id`, and `auth_token` properties are added separately for each worker:

```json
{ 
	"port": 5522,
	"secure": false,
	"socket_opts": { "rejectUnauthorized": false },
	"pid_file": "pid.txt",
	"log_dir": "logs",
	"log_filename": "[component].log",
	"log_crashes": true,
	"log_archive_path": "logs/archives/[filename]-[yyyy]-[mm]-[dd].log.gz",
	"log_archive_keep": "7 days",
	"temp_dir": "temp",
	"debug_level": 5,
	"child_kill_timeout": 10,
	"monitoring_enabled": true,
	"quickmon_enabled": true,
	"upgrade_timeout_sec": 60
}
```

Here are descriptions of the configuration properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `hosts` | Array | The conductor hostnames xySat can connect to.  This is generated and maintained automatically by xyOps. |
| `host` | String | Optional static connection hostname.  When set, this overrides the entire `hosts` array. |
| `port` | Number | The conductor or proxy port used for xySat HTTP and WebSocket traffic.  The default is `5522`.  Set this to `5523` when connecting directly to the default built-in TLS listener. |
| `secure` | Boolean | Set to `false` for HTTP and `ws://`, or `true` for HTTPS and `wss://`.  The default is `false`. |
| `socket_opts` | Object | Options to pass to the WebSocket connection (see [WebSocket](https://github.com/websockets/ws/blob/master/doc/ws.md#class-websocket)). |
| `pid_file` | String | Location of the PID file to ensure two satellites don't run simultaneously. |
| `log_dir` | String | Location of the log directory, relative to the xySat base dir (`/opt/xyops/satellite`). |
| `log_filename` | String | This string is the filename pattern used by the core logger (default: `[component].log`); supports log column placeholders like `[component]`. |
| `log_crashes` | Boolean | This boolean enables capturing uncaught exceptions and crashes in the logger subsystem (default: `true`). |
| `log_archive_path` | String | This string sets the nightly log archive path pattern (default: `logs/archives/[filename]-[yyyy]-[mm]-[dd].log.gz`). |
| `log_archive_keep` | String | How many days to keep log archives before auto-deleting the oldest ones. |
| `temp_dir` | String | Location of temp directory, relative to the base dir (`/opt/xyops/satellite`). |
| `debug_level` | Number | This number sets the verbosity level for the logger (default: `5`; 1 = quiet, 10 = very verbose). |
| `child_kill_timeout` | Number | Number of seconds to wait after sending a SIGTERM to follow-up with a SIGKILL. |
| `monitoring_enabled` | Boolean | Enable or disable the monitoring subsystem (i.e. send monitoring metrics every minute). |
| `quickmon_enabled` | Boolean | Enable or disable the quick monitors, which send lightweight metrics every second. |
| `upgrade_timeout_sec` | Number | The number of seconds to allow for upgrades to complete, before reporting an error (default: `60`). |

### Overriding The Connect URL

Normally, xySat selects a conductor from its automatically managed `hosts` array.  It connects to one of those hosts, discovers which conductor is primary, and reconnects to the primary when necessary.  If the cluster changes, the primary distributes an updated `hosts` array to all workers.

In some network layouts, workers must connect to a static proxy or load balancer instead of directly to the conductor hostnames.  Add a `host` property to override the normal conductor list.  When both `hosts` and `host` exist, `host` always takes precedence.

To override the connection for **all workers**, add `host` to the conductor's existing [satellite.config](config.md#satellite-config) object.  Merge the properties shown below into your existing configuration rather than removing the other satellite settings:

```json
"satellite": {
	"config": {
		"host": "xyops-workers.mycompany.com",
		"port": 443,
		"secure": true
	}
}
```

This is a fleet-wide static override.  In a multi-conductor installation, the hostname should point to a proxy which always routes workers to the current primary.

To override the connection for **one worker**, add a top-level `host` property to that worker's local xySat configuration file:

```
/opt/xyops/satellite/config.json
```

For a per-worker override, also configure `managed_keys` so the conductor does not overwrite the local `host` value during the next configuration sync.  See [Customizing Managed Keys](#customizing-managed-keys).

For more reverse proxy requirements and examples, see [Reverse Proxies and Worker Connections](#reverse-proxies-and-worker-connections).

### Customizing Managed Keys

By default, the entire satellite configuration object from the primary conductor server is distributed out to all remote servers when they connect, and that configuration block *overwrites* whatever is in their local `/opt/xyops/satellite/config.json` files.  This is by design, so you can maintain a single, central satellite configuration, change it at any time, and have it automatically sync to all your servers.

However, if you have a custom setup where you want some of your servers to have varying configurations, this is possible.  On those servers specifically, add a `managed_keys` property into their `/opt/xyops/satellite/config.json` files, and populate this array with all the keys that you want to allow xyOps to "manage" automatically (i.e. which ones you want to allow it to overwrite).  Example:

```json
"managed_keys": [ "server_id", "auth_token", "hosts" ]
```

This would only allow xyOps to overwrite the `server_id`, `auth_token` and `hosts` configuration keys when the server connects.  All the other configuration properties may vary, and will not be touched.  Note that it is important to always allow the `auth_token` property to be overwritten, so you can [rotate the secret key](#secret-key-rotation) from the conductor (rotating the secret key requires all server auth tokens to be regenerated).

This minimal example also preserves a per-worker static `host` override because `host` is not included in `managed_keys`.  However, it also prevents the conductor from updating every other omitted setting.  If you only want `host` to remain local, include `server_id`, `auth_token`, `hosts`, and every other setting you want centrally managed, while deliberately omitting only `host`.

### Troubleshooting xySat Installation

Start troubleshooting from the worker server, because that is where DNS, firewall, proxy, and certificate behavior must all work.

| Symptom | Likely Cause | What To Check |
|---------|--------------|---------------|
| The generated installer uses port `5522`, but people open xyOps on port `80` or `443`. | This is often correct.  The public `base_app_url` and the direct xySat connection are separate. | Confirm whether workers are intended to connect directly to the conductor.  If so, allow the worker to reach the conductor hostname on `5522`; it does not need the public UI port. |
| The generated installer contains the wrong hostname. | The conductor hostname is incorrect, or a fleet-wide `satellite.config.host` override is set. | Check the container `hostname`, `XYOPS_hostname`, `XYOPS_masters`, and `XYOPS_satellite__config__host`. |
| The installer reports that it cannot reach `BASE_URL`. | DNS, routing, firewall access, proxy routing, or the URL embedded in the bootstrap script is incorrect. | Run the tests in [Test From a Worker First](#test-from-a-worker-first), then inspect the generated `BASE_URL` as shown in [The Bootstrap BASE_URL](#the-bootstrap-base_url). |
| The installer downloads successfully, but the server remains offline. | The HTTP bootstrap route worked, but the ongoing WebSocket route did not. | Inspect the worker's `host` or `hosts`, `port`, and `secure` settings.  Verify that the proxy allows WebSocket upgrades and does not close persistent connections. |
| A direct TLS connection fails with a certificate error. | The certificate is not trusted, does not cover the conductor hostname, or xySat is using the wrong port and security mode. | Use a trusted certificate for the exact hostname, and pair `secure: true` with the TLS listener port, normally `5523`. |
| Package download fails after the worker reaches the conductor. | The conductor cannot fetch the xySat release package, or an air-gapped package is missing. | Check conductor Internet access, outbound proxy settings, `satellite.base_url`, or the configured [Air-Gapped Satellite](#air-gapped-satellite-installs) bucket. |

On Linux and macOS, the generated worker configuration is stored at:

```text
/opt/xyops/satellite/config.json
```

Check this file to confirm the final `host` or `hosts`, `port`, `secure`, and `server_id` values.  Do not share the `auth_token` value.

## Proxy Servers

### Outbound Forward Proxies

This section covers **forward proxies used for outbound requests** made by xyOps and job code.  This is different from placing a reverse proxy in front of the xyOps web server.  For inbound browser or xySat connections, see [Reverse Proxies and Worker Connections](#reverse-proxies-and-worker-connections).

To send all outbound requests through a proxy (for e.g. web hooks), simply set one or more of the [de-facto standard environment variables](https://curl.se/docs/manpage.html#ENVIRONMENT) used for this purpose:

```
HTTPS_PROXY
HTTP_PROXY
ALL_PROXY
NO_PROXY
```

xyOps will detect these environment variables and automatically configure proxy routing for all outbound requests.  The environment variable names may be upper or lower-case.  The proxy format should be a fully-qualified URL with port number.  To set a single proxy server for handling both HTTP and HTTPS requests, the simplest way is to just set `ALL_PROXY` (usually specified via a plain HTTP URL with port).  Example:

```
ALL_PROXY=http://company-proxy-server.com:8080
```

Use the `NO_PROXY` environment variable to specify a comma-separated domain whitelist.  Requests to any of the domains on this list will bypass the proxy and be sent directly.  Example:

```
NO_PROXY=direct.example.com
```

Please note that for proxying HTTPS (SSL) requests, unless you have pre-configured your machines to trust your proxy's local SSL cert, you will have to set the "SSL Cert Bypass" option in your web hooks.

The types of proxies supported are:

| Protocol | Example |
|----------|---------|
| `http` | `http://proxy-server-over-tcp.com:3128` |
| `https` | `https://proxy-server-over-tls.com:3129` |
| `socks` | `socks://username:password@some-socks-proxy.com:9050` |
| `socks5` | `socks5://username:password@some-socks-proxy.com:9050` |
| `socks4` | `socks4://some-socks-proxy.com:9050` |
| `pac-*` | `pac+http://www.example.com/proxy.pac` |

Make sure to set the environment variables across your server fleet, so things like the [HTTP Request Plugin](plugins.md#http-request-plugin) will also adhere.

## Data Migration

To migrate an existing xyOps installation to a brand new server, use the built-in bulk export and import features from the **System** tab, but make sure you copy the configuration directory by hand first.  The bulk export contains xyOps data, but it does **not** replace your server configuration files.

Before you import anything on the new server, copy the entire configuration directory from the old conductor:

```
/opt/xyops/conf
```

This directory contains your full xyOps configuration, UI configuration overrides, custom email templates, custom UI assets, conductor peer settings, and most importantly, your secret key.  The secret key is normally stored in:

```
/opt/xyops/conf/overrides.json
```

**Important:** Your Secret Vault data and API Keys are encrypted using the secret key, and conductor and worker authentication also depends on it.  You must copy the original `secret_key` value to the new server **before** importing data or adding servers.  If the new conductor starts with a different secret key and you import your old data, imported secrets will not decrypt correctly and servers may fail to authenticate.  As long as you copy the entire `/opt/xyops/conf` directory first, your imported Secrets and API Keys should work on the new server.

Here is the recommended process:

1. On the old xyOps server, go to **System** and click **Export Data**.
2. For a complete migration, select all storage lists, all database tables, and all extras that you want to preserve.
3. Install xyOps on the new server, but do not import data yet.
4. Stop xyOps on the new server if it is already running.
5. Copy the entire `/opt/xyops/conf` directory from the old server to the new server.
6. Review the copied configuration and update only server-specific settings, such as hostnames, ports, TLS paths, storage endpoints, or Docker volume paths.
7. Start xyOps on the new server and confirm that it is running with the copied configuration.
8. In the new xyOps UI, login using the default admin account, go to **System** and click **Import Data**.
9. Upload the export archive from the old server.
10. Verify users, API Keys, Secrets, events, workflows, plugins, buckets, schedules, workers, and uploaded files before retiring the old server.

If you are using Docker, copy the host directory that you bind-mounted to `/opt/xyops/conf`, such as `./xyops01-conf` in the examples above.  If you are using a manual install, copy `/opt/xyops/conf` directly.  Either way, keep a backup of the old server and the export archive until you have fully validated the new conductor.

## Air-Gapped Mode

xyOps supports air-gapped installs, which prevent it from making unauthorized outbound connections beyond a specified IP range.  You can configure which IP ranges it is allowed to connect to, via whitelist and/or blacklist.  The usual setup is to allow local LAN requests so servers can communicate with each other in your infra.

To configure air-gapped mode, use the [airgap](config.md#airgap) section in the main config file.  Example:

```json
"airgap": {
	"enabled": false,
	"whitelist": ["127.0.0.1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "::1/128", "fd00::/8", "169.254.0.0/16", "fe80::/10"],
	"blacklist": []
}
```

Set the `enabled` property to `true` to enable air-gapped mode, and set the `whitelist` and/or `blacklist` arrays to IP addresses or [CIDR blocks](https://en.wikipedia.org/wiki/Classless_Inter-Domain_Routing).  The default whitelist includes all IPs in the [private range](https://en.wikipedia.org/wiki/Private_network).

You will also need to disable the "Show Outdated Version Badges" configuration setting ([client.outdated_badges](config.md#client-outdated_badges)).  This is so xyOps will not attempt to check for outdated software versions (which would require making external requests to GitHub).

The air-gapped rules apply to both xyOps itself, and automatically propagate to all connected worker servers, to govern things like the [HTTP Plugin](plugins.md#http-request-plugin).  However, it is important to point out that they do **not** govern your own Plugin code, your own shell scripts, nor marketplace Plugins.

For handling air-gapped software upgrades safely, please contact [xyOps Support](mailto:support@pixlcore.com).  As part of the enterprise plan we can send you digitally signed packages with instructions on how to install them.

Note that all xyOps documentation is available offline inside the xyOps app.

### Air-Gapped Satellite Installs

xyOps supports fully air-gapped server installs and upgrades.  Here is how it works:

1. As part of your [enterprise plan](https://xyops.io/pricing), request a signed xySat software package from us.
2. In your xyOps instance, create a [Storage Bucket](buckets.md) and note the Bucket ID.
3. Upload the files you received into the bucket.  The filenames will be in this format: `satellite-OS-ARCH.tar.gz`.
4. Edit your conductor config file, and set the `satellite.bucket` property to the Bucket ID.
5. Install or upgrade your servers as per usual.
6. xyOps will use the xySat install packages from the bucket, and not request anything over the internet.

For Docker containers, make sure that your local Docker has our images stored locally, so they aren't pulled from the repository.  Our official containers are available at the following locations:

- **xyOps**: https://github.com/pixlcore/xyops/pkgs/container/xyops
- **xySat**: https://github.com/pixlcore/xysat/pkgs/container/xysat

## Secret Key Rotation

xyOps uses a single secret key on every conductor server. This key encrypts stored secrets, signs temporary UI tokens, and issues authentication tokens for worker servers (xySat). Rotating this key is fully automated and performed from the UI.

### Overview

- **Secure generation**: A new cryptographically secure key is generated by the primary conductor and is never transmitted in plaintext.
- **Orchestrated rotation**: The scheduler is paused, queued jobs are flushed, and active jobs are aborted before rotation proceeds.
- **Seamless re-encryption**: All stored secrets are re-encrypted with the new key.
- **Re-authentication**: All connected xySat servers are re-authenticated and issued new auth tokens automatically.
- **Peer distribution**: The new key is distributed to all conductor peers (backup conductors) encrypted using the prior key.
- **Persistent config**: The new key is written to `/opt/xyops/conf/overrides.json`. The base `config.json` is not modified by design (often mounted read-only in Docker).
- **Not impacted**: Existing user sessions and API keys remain valid and are not affected by key rotation.

### Pre-Checks

Before starting a rotation, ensure that all conductors and all worker servers are online and healthy:

- Verify that every conductor is reachable and participating in the cluster.
- Verify that all worker servers show as online in the Servers list.

If a node is offline during rotation, it will not receive updates automatically. See [Offline Recovery](#offline-recovery) below.

### Rotation Process

1. Click on the "System" link in the Admin section in the sidebar, and start Key Rotation.
2. The system pauses the scheduler, flushes queued jobs, and aborts active jobs.
3. A new key is generated and used to re-encrypt all secrets.
4. Connected worker servers are issued new auth tokens.
5. The new key is securely distributed to all conductor peers.
6. The key is persisted to `/opt/xyops/conf/overrides.json` on each conductor.
7. The schedule remains paused until you resume it (click the "Paused" icon in the header).

No manual edits or restarts are required when all nodes are online.

### Offline Recovery

If a server or conductor was offline during the rotation window, you will need to perform the appropriate recovery action.

#### Re-authenticate an Offline Worker Server

If a worker server missed the rotation, you can recover it by deriving a new auth token manually.

What you need:

- The current secret key from the primary conductor. This is only available on-disk via SSH to the conductor: `/opt/xyops/conf/overrides.json` (`secret_key`). It is not retrievable via API.
- The offline server's alphanumeric ID (e.g. `smf4j79snhe`). You can find this in the UI on the server history page, or on the server itself in `/opt/xyops/satellite/config.json`.

Compute the SHA-256 of the concatenation: `SERVER_ID + SECRET_KEY`, and use the hex digest as the new auth token. Example:

```sh
## OpenSSL
printf "%s" "SERVER_IDSECRET_KEY" | openssl dgst -sha256 -r | awk '{print $1}'
```

Then edit the satellite config on the worker:

```
/opt/xyops/satellite/config.json
```

Set the `auth_token` property to the computed SHA-256 hex string. Save the file -- the satellite will auto-reload and attempt to reconnect within ~30 seconds. Check the satellite logs for troubleshooting.

#### Update an Offline Conductor

If a conductor was offline during rotation, SSH to it and update the key by hand:

1) Open `/opt/xyops/conf/overrides.json` on the offline conductor.
2) Set the `secret_key` property to the new key from the primary conductor. If the file lacks `secret_key` (e.g. first rotation), add it.
3) Save the file and restart the conductor service if needed.

After the update, the conductor will rejoin the cluster with the correct key.

### Best Practices

- Schedule rotations during a maintenance window to tolerate job aborts.
- Confirm node health beforehand to avoid manual recovery steps.
- Store the current key securely and restrict SSH access to conductors.
- Rotate periodically as part of your security program (see [Security Checklist](scaling.md#security-checklist)).

## Preferred Conductors

By default, primary selection in a multi-conductor cluster is "sticky."  Once a conductor becomes primary, it remains primary indefinitely, even if a higher-ranked conductor later comes back online.  The cluster only selects a different primary when the current one shuts down, restarts, or suffers a hardware failure.

Configuring **Preferred Conductors** changes this behavior.  As soon as the preferred conductor list contains at least one hostname, xyOps enables active primary handoffs.  A lower-ranked primary will routinely check for higher-ranked preferred conductors and automatically relinquish command when one becomes eligible.  The cluster then holds a new election, allowing the preferred conductor to take over as primary.

This allows the cluster to fail over normally when a preferred conductor is unavailable, and then automatically return command when that conductor comes back online.  For example, you can designate your main production conductor as preferred.  A backup can become primary during an outage, but it will step aside after the preferred conductor returns, reconnects, and meets the minimum age requirement.

### Active Primary Handoffs

The current primary checks its connected peers once per minute, on the `:30` second, to see whether it should relinquish command.  A peer is eligible to take over when:

- It is included in the Preferred Conductors list.
- It outranks the current primary.  If the current primary is not in the list, every listed conductor outranks it.
- It is online and connected to the current primary.
- Its connection has met the configured **Relinquish Minimum Age**.

The minimum age prevents a newly connected or unstable peer from immediately causing a primary change.  It is measured in seconds from the peer's most recent connection, and defaults to `60` seconds.

You can also enable **Relinquish Wait For Jobs**.  When enabled, the primary defers relinquishing command while active jobs are running, then checks again on the next minute.  When disabled, active jobs do not delay the relinquish operation.  Internal system jobs (i.e. daily maintenance, DB optimization, etc.) always prevent relinquishing until they have completed.

### Election Ranking

The preferred list also controls candidate ranking whenever the cluster holds an election.  By default, xyOps ranks all online conductor candidates alphabetically by hostname, and the first available hostname becomes primary.  With Preferred Conductors configured, hostnames in the list are ranked first, in the exact order you specify.  All unlisted conductors follow them in alphabetical order.

For example, consider this cluster:

```text
xyops01.internal.mycompany.com
xyops02.internal.mycompany.com
xyops03.internal.mycompany.com
```

With the following preferred list:

```json
[ "xyops03.internal.mycompany.com", "xyops02.internal.mycompany.com" ]
```

The effective election order is:

1. `xyops03.internal.mycompany.com`
2. `xyops02.internal.mycompany.com`
3. `xyops01.internal.mycompany.com`

You do not need to include every conductor.  A list containing only `xyops03.internal.mycompany.com` ranks that server above all the others and activates automatic handoffs to it.  The remaining servers retain their alphabetical order.  Unlisted conductors are still valid election candidates and can become primary whenever all higher-ranked online candidates are unavailable.  If the preferred list is empty, xyOps uses the original sticky primary behavior and alphabetical election ranking.

### Configuration

You can edit these settings in the **Server Configuration** page in the xyOps UI, or configure them directly inside the [`multi`](config.md#multi) object in `/opt/xyops/conf/config.json`:

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

The three properties are:

| Property | Description |
|----------|-------------|
| [`multi.preferred_conductors`](config.md#multi-preferred_conductors) | An array of exact conductor hostnames, ordered from highest to lowest priority. |
| [`multi.relinquish_min_age`](config.md#multi-relinquish_min_age) | The minimum peer connection age, in seconds, required before the primary will relinquish command.  The default is `60`. |
| [`multi.relinquish_wait_jobs`](config.md#multi-relinquish_wait_jobs) | When `true`, wait for active jobs to complete before relinquishing command.  The default is `false`. |

> [!IMPORTANT]
> All conductor servers **must agree** on the same Preferred Conductors list and relinquish settings.  Changes made on the **Server Configuration** page are automatically synchronized across all conductor servers.  If you edit the raw `config.json` file instead, you must apply the same list, in the same order, and the same relinquish settings to every conductor server yourself.
