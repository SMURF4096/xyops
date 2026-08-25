# xyOps Security Overview

## Overview

This document explains how xyOps protects user accounts, secrets, API access, job execution, and server-to-server communication.

xyOps is designed around a few core ideas with regard to security:

- Keep sensitive data out of the browser unless it is truly needed.
- Encrypt secrets at rest and decrypt them only at the moment of use.
- Treat code execution, outbound HTTP, and system automation as administrator-controlled features.
- Default standard users into a narrow privilege set.
- Prefer explicit tokens, audit logs, and scoped privileges over implicit trust.
- Keep the platform self-hostable, without requiring a vendor cloud control plane to operate.

This document is not a claim that xyOps is bug-free, and it is not a substitute for good deployment hygiene. TLS, reverse proxies, SSO gateways, operating system hardening, backup handling, and administrator choices still matter.


## Why Trust xyOps

At a high level, xyOps is built to keep a strong boundary between ordinary users, administrators, and remote worker servers:

- Passwords are salted and bcrypt-hashed, not stored in plaintext.
- Browser sessions use cryptographically generated session IDs and CSRF tokens.
- Session cookies are `HttpOnly` by default, use `SameSite=Lax`, and only set `Secure` when the request is actually HTTPS.
- API keys are never stored in plaintext and are only shown once when created.
- Secret Vault values are encrypted at rest using authenticated encryption.
- Sensitive request fields such as `session_id`, `csrf_token`, and `api_key` are scrubbed from request state after authentication to reduce accidental logging.
- The remote worker agent, xySat, does not open inbound listeners. It connects outbound to the conductor and authenticates before it can do anything.
- Powerful features such as shell scripts, arbitrary URLs, plugin installation, web hooks, marketplace plugins, and system hooks are administrator-controlled by default.


## Architecture

xyOps is not built on a conventional Express or React stack. It uses the first-party PixlCore framework family on both the server and client side.

### Core Components

| Component | Role | Security Relevance |
|----------|------|--------------------|
| [pixl-server](https://github.com/jhuckaby/pixl-server) | Top-level daemon and component manager | Controls startup, shutdown, config loading, logging, and component wiring. |
| [pixl-server-api](https://github.com/jhuckaby/pixl-server-api) | REST API router | Normalizes API names and only dispatches to registered methods. xyOps exposes app methods through the `api_` prefix. |
| [pixl-server-debug](https://github.com/jhuckaby/pixl-server-debug) | Optional debug port | Disabled by default. Must be explicitly enabled in config or environment. |
| [pixl-server-storage](https://github.com/jhuckaby/pixl-server-storage) | Persistent storage abstraction | Handles JSON records, lists, hashes, files, locking, and transactions across multiple backends. |
| [pixl-server-user](https://github.com/jhuckaby/pixl-server-user) | User auth and session system | Handles passwords, sessions, cookies, password reset flow, and CSRF. |
| [pixl-server-web](https://github.com/jhuckaby/pixl-server-web) | HTTP and HTTPS server | Handles request parsing, uploads, static files, limits, timeouts, and response headers. |
| [pixl-server-unbase](https://github.com/jhuckaby/pixl-server-unbase) | Query layer on top of storage | Queries are read-only and separate from write APIs. |
| [pixl-xyapp](https://github.com/pixlcore/pixl-xyapp) | Browser-side SPA framework | Adds CSRF headers to mutating requests and keeps session-related state in runtime memory. |

The main trust boundaries in xyOps are:

- Browser to conductor
- Conductor to storage
- Conductor to xySat worker agents
- Conductor to peer conductors in multi-conductor mode
- xySat to local child processes that run jobs and monitor plugins
- xyOps to external HTTP destinations such as web hooks


## Protected Assets

The most sensitive things in a typical xyOps deployment are:

- User password hashes and salts
- Session IDs and CSRF tokens
- API key material at creation time
- The global `secret_key`
- Encrypted Secret Vault payloads
- Satellite and peer authentication tokens derived from the secret key
- Configuration credentials such as mail auth, S3 credentials, and SSO settings
- Job logs, uploads, exported backups, and ticket attachments that may contain sensitive user data

xyOps protects these in different ways depending on the asset. Some are hashed, some are encrypted, some are never sent to the browser, and some are only exposed one time at creation.

### Credentials and Tokens

| Item | Stored How | Sent to Browser? | Notes |
|------|------------|------------------|-------|
| User password | Per-user salt plus bcrypt hash | No | Passwords are never stored in plaintext. |
| Session ID | Random token stored as session record | Usually only in cookie mode as `session_id` cookie | Session cookie is `HttpOnly` by default. |
| CSRF token | Random token stored inside session | Yes, after login or session resume | Held in runtime memory on the client, not `localStorage`. |
| API key | Salted SHA-256 hash only | Plaintext shown once at creation | Stored hash is based on the key plus the key ID. |
| Secret Vault values | AES-256-GCM encrypted record | No, unless an admin explicitly decrypts a secret | Decrypted only in memory when needed. |
| Literal values in web hook definitions | Plaintext shared configuration | Yes, to authenticated users | Do not place credentials directly in web hook URLs, headers, bodies, titles, or notes. Use a Secret Vault reference instead. |
| `secret_key` | Config override file with owner-only permissions | No | Also excluded from config APIs. |
| Satellite auth token | Derived token based on server ID and secret key | No | Used by xySat to authenticate to the conductor. |


## Accounts and Sessions

### Password Storage

xyOps uses `pixl-server-user` for local account management. Passwords are protected as follows:

- Each user gets a random salt.
- The stored password is a bcrypt hash of `password + salt`.
- Passwords are never stored in plaintext.
- Password and salt fields are removed from user objects before they are returned to the client.

By default, bcrypt is enabled in `sample_conf/config.json`:

```json
"User": {
	"use_bcrypt": true
}
```

### Throttling

The default user configuration adds several protections:

- Maximum failed logins: `5` per hour per user
- Maximum forgot-password requests: `3` per hour per user
- Username format restricted to letters, digits, underscore, dash, and dot
- Reserved and unsafe keys such as `constructor` and `__proto__` are blocked

This reduces brute-force pressure and avoids common JavaScript object-key attacks.

### Sessions

When a user logs in, xyOps creates a session record containing:

- a cryptographically generated session ID
- the username
- the request IP and user agent
- timestamps for creation, modification, and expiration
- a CSRF token if CSRF is enabled

The default session lifetime in xyOps is `365` days. Sessions are stored server-side, not encoded into a browser token.

### Cookies

In the default xyOps configuration, the session is delivered using a cookie rather than returning the session ID in the JSON login response. The default cookie settings are:

```json
"cookie_settings": {
	"path": "/",
	"secure": "auto",
	"httpOnly": true,
	"sameSite": "Lax"
}
```

This means:

- `HttpOnly`: browser JavaScript cannot read the session cookie
- `SameSite=Lax`: reduces cross-site request risks for ordinary navigation patterns
- `Secure=auto`: the cookie is marked `Secure` when the incoming request is HTTPS

### CSRF Protection

CSRF protection is enabled by default.

- A random CSRF token is generated per session.
- The token is returned to the browser after login or session resume.
- The `pixl-xyapp` client automatically adds `X-CSRF-Token` to all `POST` requests when `app.csrf_token` is present.
- The token lives in the in-memory global `app` object and is not stored in `localStorage` or `sessionStorage`.
- Server-side CSRF checks apply to mutating requests. `GET` and `HEAD` are exempt.

xyOps only uses HTTP `GET` and `POST` for its own REST API.

### Session Scrubbing

After a session or API key is loaded, xyOps removes auth material from common request containers:

- `session_id`
- `csrf_token`
- `api_key`
- the raw `cookie` header

This reduces the chance of those values leaking into downstream logs, debug output, or application code that does not need them.

### User Security Activity

xyOps also exposes account-oriented security history, including login activity, and allows users to log out all sessions after re-entering their password. This gives users a practical response if they suspect account compromise.


## API Keys

API keys in xyOps are designed for services and automation, not human browser sessions.

### Key Protection

- Only administrators can create them.
- Each key gets its own ID, title, privilege set, revision history, and active flag.
- The plaintext key is generated once and shown once.
- xyOps stores only a salted SHA-256 hash of the key, not the plaintext.
- A masked version is stored for display convenience.
- Each key can have an optional expiration date, after which it auto-disables.
- You can set a max req/sec for each key, for throttling.

The stored hash is:

- `SHA-256(plain_key + key_id)`

So even if the API key list is exposed, the plaintext key is not recoverable from storage alone.

### Key Authentication

An API key can be sent in three places:

- `X-API-Key` header
- `api_key` query string parameter
- `api_key` JSON parameter

For security and log hygiene, the header form is the best choice.

Once matched, the API key becomes a simulated session object, and its privileges are enforced through the same permission system used for normal users and roles.

### Key Lifecycle

API keys can be:

- created
- updated
- disabled
- expired
- deleted

Deleting a key also clears its cached rate-limit and usage state.


## Secret Vaults and Encryption

Secret Vaults are the main way xyOps stores sensitive runtime configuration such as passwords, tokens, and API credentials.

### Storage Layout

Each secret is split into two parts:

- Plaintext metadata
  - `id`, `title`, `enabled`, `icon`, `notes`
  - variable names only
  - assignment lists such as events, categories, plugins, and web hooks
- Encrypted payload
  - the actual secret values

This design lets the UI list, search, and assign secrets without constantly decrypting them.

### Encryption Details

Secret values are encrypted at rest using:

- Algorithm: `AES-256-GCM`
- Key derivation: `scrypt`
- scrypt parameters: `N=16384, r=8, p=1`
- Per-record random salt: `16` bytes
- Per-record random IV/nonce: `12` bytes
- Additional Authenticated Data: the secret ID, bound into the record

This gives both confidentiality and integrity protection, and prevents encrypted blobs from being swapped between records without detection.

### Decryption Lifecycle

xyOps decrypts secrets only when needed:

- just before launching a job or plugin that has access to them
- just before rendering a web hook that references them
- when an administrator explicitly requests decryption in the UI or API

Routine use decrypts values in memory and injects them into the runtime context:

- Jobs receive them as environment variables.
- Web hooks access them via `{{ secrets.VAR_NAME }}`.

### Secret Access Auditing

Secret access is auditable in two ways:

- Routine runtime use is logged to the dedicated `Secret` log stream without logging secret values.
- Explicit administrator decryption is logged to the Activity Log with the acting username.

### Operational Note

xyOps protects secret values at rest, but once a secret is handed to a job or web hook, the downstream code can still expose it. For example:

- a script can print an environment variable into a job log
- a web hook can send a secret to a third-party service
- a plugin can store secret-derived data in its own output

So Secret Vaults protect storage and controlled delivery, not arbitrary downstream behavior.

Literal values placed directly in ordinary configuration are not Secret Vault values. In particular, web hook definitions are shared with authenticated users so they can be listed and selected by other xyOps features. A credential placed directly in a web hook URL, header, body, title, or notes is therefore stored and exposed as ordinary plaintext configuration. Store the credential in a Secret Vault and reference it with an expression such as `{{ secrets.API_TOKEN }}` or `{{ secrets.WEBHOOK_URL }}`.


## The Global Secret Key

xyOps uses one global `secret_key` for several security-sensitive operations.

### Where It Lives

The key lives in the config override file, typically:

- `conf/overrides.json`

xyOps protects both `config.json` and `overrides.json` with owner-only permissions (`chmod 600`) during startup and update operations.

### Uses

The secret key is used to:

- derive encryption keys for Secret Vault records
- derive satellite authentication tokens
- derive multi-conductor peer authentication tokens
- derive per-job download and stream tokens
- protect other internal tokenized flows that should not expose the raw secret itself

### Generation

xyOps generates an initial secret key automatically during first install:

- container startup uses `openssl rand -hex 32`
- standard installs use a cryptographically generated value written to the overrides file

### Protection

xyOps deliberately keeps the secret key off normal client surfaces:

- it is not sent to the browser
- it is not returned by the admin config APIs
- it is excluded when config is sent to the public client bootstrap

### Secret Key Rotation

xyOps includes an orchestrated secret-key rotation flow for administrators. The rotation process is designed to avoid partial updates:

- scheduler is paused
- queued jobs are flushed
- active jobs are aborted and allowed to drain
- all encrypted secrets are re-encrypted with the new key
- connected servers are re-issued fresh auth tokens
- peer conductors are sent the new secret, fully encrypted using the old one

This is much safer than manually changing a key and hoping all dependent systems catch up.


## xyOps Satellite

xySat (xyOps Satellite) is the remote worker and monitoring agent for xyOps. It is security-sensitive because it is the component that actually runs jobs on your servers.

### No Inbound Listener

xySat does **not** expose an inbound service surface of its own:

- it does not run an HTTP server
- it does not open a socket listener
- it does not wait for inbound commands from the network

Instead, xySat connects outbound to the conductor over the same WebSocket infrastructure used by the platform.

### Authentication

During enrollment, the conductor provisions the satellite with:

- a server ID
- a SHA-256 auth token derived from the server ID and the conductor secret key

On connection:

- xySat starts the handshake sequence
- the conductor issues an auth challenge
- xySat replies with either its configured `auth_token` or the legacy nonce-based token
- only after successful authentication does the conductor treat the socket as a live server

Unauthenticated or stale sockets are dropped after 30 seconds.

### Elevated Privileges

The default guided installer runs with root or administrator privileges because it typically needs to:

- install under `/opt/xyops/satellite`
- register itself as a startup service
- manage its own service lifecycle
- support self-upgrade flows that replace files in its install directory

That install-time privilege does **not** mean every job has to run with the same privilege.

### Reduced-Privilege Jobs

On POSIX systems, xySat can drop child processes to a configured UID and GID before launching a plugin. This is one of the most important production hardening controls in xyOps.

You can:

- set `uid` and `gid` on individual plugins
- set defaults per plugin type via `default_plugin_credentials`

This allows you to install xySat with enough privilege to manage itself, but still run routine jobs as a dedicated low-privilege account such as `xyops`.

### Manual Installation

It is also possible to install and run xySat manually as a non-root user. That can be a good fit for tightly controlled environments, but it comes with tradeoffs:

- service registration may require extra manual setup
- self-upgrade may fail unless the user owns the install directory and restart path
- on POSIX systems, the process cannot switch child jobs to a different UID or GID unless the OS grants it that privilege

On Windows, there is no native UID/GID model like POSIX, so process identity isolation [must be handled differently](https://docs.xyops.io/#Docs/scaling/plugin-credentials).

### Job Execution

When xySat launches a job:

- it creates a per-job working directory
- it downloads any input files into that directory
- it prepares a controlled environment for the child process
- it strips parent environment variables prefixed with `XYOPS_`, `XYSAT_`, and `SATELLITE_`
- it injects job metadata and assigned secrets as environment variables
- it launches the plugin command or built-in plugin wrapper

This keeps the child focused on just the job context instead of inheriting the entire satellite process environment.

### Shell Scripts

The built-in Shell Plugin is intentionally powerful. It exists so administrators can run shell scripts quickly, including scripts with shebang lines that invoke other languages.

By default:

- the Shell Plugin `script` field is administrator-locked
- non-admin users cannot fill in or modify that script text
- server-side event APIs enforce locked plugin parameters, not just the UI

This same pattern applies to other sensitive built-in plugin fields, including:

- the HTTP Request plugin `url`
- several Docker plugin launch fields such as image name and command extras

So xyOps does not merely hide these controls in the browser. It preserves locked values on the server for non-admin users.


## Privileges and Admin Controls

xyOps uses a flexible privilege system with users, roles, and API keys.

### Default Privileges

New users are granted only this default set:

```json
"default_user_privileges": {
	"create_events": true,
	"edit_events": true,
	"run_jobs": true,
	"tag_jobs": true,
	"create_tickets": true,
	"edit_tickets": true
}
```

Notably absent by default:

- `create_plugins`
- `edit_plugins`
- `create_web_hooks`
- `edit_web_hooks`
- `add_servers`
- `admin`

So ordinary users do not start with the ability to define new executable code, add servers, install plugins, or create outbound integrations.

### Resource-Level Checks

xyOps also enforces resource-specific checks where appropriate, including:

- category access
- server group access
- target server access
- workflow node privilege checks

This means having a broad privilege is not always enough by itself.

### Admin Features

Several surfaces are intentionally administrator-controlled because they can cross strong trust boundaries:

- plugin creation and editing
- Shell Plugin code
- HTTP Request plugin target URLs
- web hooks
- Secret Vault decryption
- API key creation
- server enrollment
- config editing
- system hooks
- marketplace plugin installation

This is an important theme in xyOps: powerful automation is a feature, but it is not handed to low-privilege users by default.


## WebSockets and Tokens

xyOps uses several authenticated real-time network communication channels.

### Browser Sockets

The browser maintains a WebSocket to the conductor for:

- live job logs
- notifications
- server time and updates
- real-time page data refresh

Authentication is based on the ordinary session cookie. Until a socket authenticates successfully, it has no trusted role. Unauthenticated sockets are terminated after roughly 30 seconds.

### Satellite Sockets

Each xySat instance maintains a persistent WebSocket to the conductor for:

- job status updates
- live log and metadata streaming
- monitoring samples
- monitor plugin test results

The default auth model uses a SHA-256 auth token derived from:

- `server_id + secret_key`

There is also legacy nonce-based authentication support for compatibility, but the preferred model is the server auth token.

xySat uses exponential backoff on reconnect to avoid thundering-herd behavior after outages.

### Peer Sockets

In multi-conductor setups, peers authenticate to each other using digests derived from:

- `host_id + secret_key`

This allows peers to form a trusted control plane without sharing the raw secret over the socket as part of normal operation.

### Derived Tokens

xyOps also uses derived tokens for internal file and stream flows, for example:

- job log and file download tokens
- SSE stream tokens
- satellite upload and finish-job authentication

These tokens are derived from job IDs, server IDs, and the secret key. The raw secret key itself is not embedded in URLs.


## Web Server and APIs

xyOps replaces Express-style middleware stacks with [pixl-server-web](https://github.com/jhuckaby/pixl-server-web) and [pixl-server-api](https://github.com/jhuckaby/pixl-server-api).

### API Routing

`pixl-server-api` normalizes API names to a restricted character set and dispatches only to registered handlers. In xyOps, app APIs are namespaced and use the `api_` prefix, so malformed URLs do not automatically gain access to arbitrary methods.

### Static File Safety

`pixl-server-web` resolves static file requests against the configured web root and rejects paths that resolve outside it. This provides strong built-in resistance to path traversal against the htdocs tree.

### Limits and Timeouts

The stock web server configuration includes:

- maximum upload size: `1 GB`
- idle timeout: `30` seconds
- keep-alive timeout: `30` seconds
- maximum concurrent connections: `2048`
- maximum concurrent requests: `256`

These are not a substitute for upstream rate limiting, but they do place useful bounds on resource usage.

### Security Headers

By default, xyOps configures strict security headers for HTML routes, including:

- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`

The default CSP starts from `default-src 'none'` and then explicitly allows the resources the SPA needs.

### Validation and Sanitization

xyOps APIs include several safety checks:

- required parameters are validated against regex rules
- reserved and unsafe object keys are rejected globally
- titles cannot contain raw `<` or `>` HTML metacharacters
- notes, labels, and messages have tags stripped
- Markdown and rich content rendering go through [sanitize-html](https://www.npmjs.com/package/sanitize-html)

This helps defend against both malformed input and prototype-pollution style key injection.

### File Handling

Uploaded filenames are sanitized with basename and character filtering. When serving files back:

- MIME type is derived from the stored filename
- HTML content is forced to download as an attachment instead of being rendered inline

This is especially important for user-uploaded or job-generated files.

### Config API Redaction

The admin config APIs explicitly strip sensitive areas from responses, including:

- `secret_key`
- `SSO`
- `Debug`
- the config overrides file path

The unauthenticated client bootstrap API also returns only a safe subset of client configuration.

### Error Messages

Auth-related APIs intentionally use vague error messages such as "Access denied" or "Authentication failed" for certain failure cases. This reduces the amount of internal detail exposed to an attacker.


## Database and Storage Safety

xyOps uses [pixl-server-storage](https://github.com/jhuckaby/pixl-server-storage) plus [pixl-server-unbase](https://github.com/jhuckaby/pixl-server-unbase), not traditional SQL.

### Storage Layer

The storage layer is a key/value and file abstraction that supports multiple backends, including:

- Filesystem
- SQLite
- S3-compatible stores
- Redis
- hybrids of the above

Because records are addressed as storage keys rather than raw user-supplied filesystem paths, common path traversal assumptions do not apply in the usual way.

### Query Layer

`pixl-server-unbase` is a read-only query system on indexed JSON records:

- queries read indexed records
- queries cannot write
- queries cannot execute arbitrary functions
- inserts, updates, and deletes are separate APIs

This materially reduces the attack surface compared to dynamic SQL or scriptable query engines.


## Outbound HTTP

xyOps includes outbound HTTP features by design.

### Web Hooks

Web hooks are reusable outbound HTTP definitions that can send notifications to external systems.

Important defaults:

- ordinary users cannot create, edit, delete, or test web hooks unless granted the corresponding privilege
- authenticated users can read web hook definitions because they are shared configuration used by events, alerts, workflows, and other client features
- literal URL, header, and body values are visible as part of those definitions and must not contain credentials
- web hooks can use Secret Vault values through template expansion
- web hook activity is observable and testable

### HTTP Request Plugin

The built-in HTTP Request plugin is intentionally capable of talking to arbitrary URLs, including internal hosts, `localhost`, and cloud metadata endpoints. That is a feature, because administrators often need internal orchestration.

However:

- the URL field is administrator-locked by default
- non-admin users cannot set it out of the box
- the same administrator who can unlock that field could also use the Shell Plugin to run `curl` directly

So this is an administrator-controlled automation surface, not an unintended SSRF bug.

### Airgap Enforcement

Both web hooks and the HTTP Request plugin honor xyOps airgap controls. If you configure IP allowlists or blocklists for outbound access, those rules are pushed into the relevant request paths, including xySat where appropriate.


## Marketplace and System Hooks

### Marketplace Plugins

Marketplace plugins are third-party packages, but they are still gated by the xyOps privilege model:

- marketplace entries are vetted by PixlCore before being admitted to the official marketplace
- only administrators, or users with explicit plugin privileges, can install them
- marketplace plugins cannot set their own `uid` or `gid`
- they always use the custom plugin credentials you configure

That last point matters because it stops a marketplace package from declaring its own runtime identity.

### System Hooks

System Hooks allow administrators to trigger global actions such as:

- outbound web hooks
- email
- ticket creation
- shell commands

They are configured in the server config, not as ordinary user content. Standard users have no UI or API surface to add or edit these.


## Expressions and Templates

xyOps uses JEXL-based expressions for monitors, alerts, messages, workflow controllers, plugin parameters, web hooks, and templates.

From a security standpoint, the key point is:

- this is **not** JavaScript `eval`
- this is **not** a general VM
- expressions only see the context objects explicitly passed to them
- they cannot escape into native server execution

This is the reason xyOps uses JEXL instead of letting users run arbitrary JavaScript expressions.


## Auditing and Logging

xyOps treats security events as something operators should be able to review.

Examples of audit-worthy actions include:

- user logins and logouts
- secret creation, update, delete, and admin decryption
- API key lifecycle events
- plugin, event, and config changes
- conductor and peer changes
- server enrollment and connectivity changes

That said, job logs are application output. If a script prints a password, token, or secret value into stdout or stderr, xyOps will record it like any other log output. So operators should treat job logs, exports, and backups as sensitive data.


## Administrator Authority

xyOps is opinionated about trust boundaries, but it does not try to "save" administrators from every deliberate action. In particular, it does not prevent a trusted admin from:

- writing a shell script that accesses internal resources
- pointing a web hook or HTTP Request plugin at a private URL
- running plugins as root
- exposing secrets by printing them into logs
- installing third-party plugins without reviewing them

This distinction matters. These are administrative power features, not default rights given to ordinary users.


## Production Hardening

The defaults are a solid starting point, but production deployments should still harden the environment around xyOps.

Recommended steps:

- Enable HTTPS directly or behind a trusted TLS proxy.
- Restrict inbound IPs with `WebServer.whitelist` or upstream firewalls.
- Limit valid host headers with `WebServer.allow_hosts`.
- Rotate the global secret key periodically.
- Run event, action, monitor, and scheduler plugins as dedicated low-privilege users via `default_plugin_credentials`.
- Keep plugin creation, plugin editing, server enrollment, web hook editing, and admin access tightly scoped.
- Protect backups, exports, log archives, and uploaded files as sensitive data.
- Tune upload limits and connection limits to your real workload.
- Use airgap controls if outbound request destinations should be restricted.
- Review Docker plugin usage carefully and avoid broader privilege than necessary.

For detailed deployment guidance, see [Self-Hosting](https://docs.xyops.io/hosting) and [Scaling](https://docs.xyops.io/scaling).


## Related Documents

- [Threat Model](THREAT_MODEL.md)
- [Security Reporting](https://docs.xyops.io/security)
- [Secrets](https://docs.xyops.io/secrets)
- [API Reference](https://docs.xyops.io/api)
- [Privileges](https://docs.xyops.io/privileges)
- [Self-Hosting](https://docs.xyops.io/hosting)
- [Scaling](https://docs.xyops.io/scaling)
- [Web Hooks](https://docs.xyops.io/webhooks)
- [xyOps Expression Format](https://docs.xyops.io/xyexp)
