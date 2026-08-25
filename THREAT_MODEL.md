# xyOps Threat Model

## Purpose

This document is not a vulnerability report, and it is not a claim that xyOps is free of security bugs. Its purpose is to prepare future auditors, whether human or AI, to review the xyOps codebase with the correct architectural context, so they can spend more time finding real vulnerabilities and less time reporting intended administrator-controlled features as bugs.

xyOps is not built on a conventional Node.js web stack. It does not use Express, Passport, React, TypeScript, or standard off-the-shelf session middleware. Instead, xyOps is built on the PixlCore software stack, with first-party modules handling HTTP, API routing, storage, user auth, and the SPA client framework. Auditors should assume that standard Node.js framework instincts will often be wrong here unless validated against the local code and module documentation.

## Auditor Preparation

Before auditing xyOps, do the following:

1. Run `npm install` in the repository root so all first-party framework modules are available locally in `node_modules/`.
2. Read the top-level `README.md`.
3. Read `docs/dev.md` to understand the PixlCore module stack used by xyOps.
4. Read the local READMEs and source for the primary framework modules:

| Module | Local README | Key local source |
|--------|--------------|------------------|
| `pixl-server` | `node_modules/pixl-server/README.md` | `node_modules/pixl-server/server.js`, `node_modules/pixl-server/component.js` |
| `pixl-server-api` | `node_modules/pixl-server-api/README.md` | `node_modules/pixl-server-api/api.js` |
| `pixl-server-debug` | `node_modules/pixl-server-debug/README.md` | `node_modules/pixl-server-debug/debug.js` |
| `pixl-server-storage` | `node_modules/pixl-server-storage/README.md` | `node_modules/pixl-server-storage/storage.js` |
| `pixl-server-user` | `node_modules/pixl-server-user/README.md` | `node_modules/pixl-server-user/user.js` |
| `pixl-server-web` | `node_modules/pixl-server-web/README.md` | `node_modules/pixl-server-web/web_server.js`, `node_modules/pixl-server-web/lib/static.js` |
| `pixl-server-unbase` | `node_modules/pixl-server-unbase/README.md` | `node_modules/pixl-server-unbase/main.js` |
| `pixl-xyapp` | `node_modules/pixl-xyapp/README.md` | `node_modules/pixl-xyapp/js/base.js` |
| `pixl-tools` | `node_modules/pixl-tools/README.md` | `node_modules/pixl-tools/tools.js` |

5. Read the xyOps docs that define expected behavior and security-sensitive features:
   - `docs/api.md`
   - `docs/config.md`
   - `docs/dev.md`
   - `docs/hosting.md`
   - `docs/privileges.md`
   - `docs/scaling.md`
   - `docs/secrets.md`
   - `docs/security.md`
   - `docs/sso.md`
   - `docs/syshooks.md`
   - `docs/webhooks.md`
   - `docs/xyexp.md`

If the audit includes the remote satellite agent itself, also inspect the separate `xysat` codebase. The conductor repository contains the conductor-side auth and bootstrap logic, but not all satellite implementation details.

## Scope and Non-Goals

This document focuses on the xyOps conductor application and the security model around:

- user authentication
- session management
- cookies
- CSRF
- API keys
- secret key handling
- encrypted secret storage
- WebSocket auth
- satellite and peer auth tokens
- web hooks and outbound HTTP
- plugin privilege boundaries
- config protection
- tokenized download and streaming links

This document does not attempt to prove:

- that every deployment is hardened by default
- that every administrator choice is safe
- that administrator-controlled code execution surfaces should be treated as bugs
- that external reverse proxies, TLS terminators, SSO middleware, or identity providers are correctly configured

## Security Review Philosophy

When auditing xyOps, separate these three classes of behavior:

1. Real vulnerability
   - An untrusted or lower-privileged actor can cross a trust boundary they should not cross.
   - Examples: auth bypass, privilege escalation, secret disclosure, CSRF bypass, unsafe token forgery, broken isolation between tenants/users/servers, or remote code execution reachable by non-admins.

2. Intended administrator capability
   - xyOps intentionally allows administrators to define code, URLs, commands, templates, hooks, and container settings.
   - This is not a vulnerability by itself.
   - It becomes a vulnerability only if non-admins can reach it unexpectedly, if privilege checks are bypassable, or if secrets leak across those boundaries.

3. Deployment hardening issue
   - Some risks depend on how the app is deployed rather than a code defect in xyOps.
   - Examples: running over plain HTTP in production, misconfigured SSO reverse proxy, permissive CORS added by an operator, plugins running as root, Docker socket exposure, or inadequate inbound IP filtering.

## High-Value Assets

The most sensitive assets in xyOps are:

- the global `secret_key`
- encrypted secret vault payloads and their runtime plaintext values
- user password hashes and salts
- user sessions and CSRF tokens
- API key material at creation time
- satellite and peer authentication tokens derived from the secret key
- mail, storage, SSO, and other credentials stored in config files
- job logs and uploaded files that may contain credentials or sensitive output
- administrator-controlled plugin definitions, web hooks, system hooks, and config overrides

## System Overview

At a high level, xyOps is:

- a Node.js backend
- a custom HTTP/HTTPS server built on `pixl-server-web`
- a REST API router built on `pixl-server-api`
- a user/session system built on `pixl-server-user`, extended by xyOps hooks
- a storage layer built on `pixl-server-storage`
- a database-like query layer built on `pixl-server-unbase`
- a single-page browser client built on `pixl-xyapp`
- a WebSocket hub for browser clients, satellites, and conductor peers

The initial browser application is a SPA. The frontend does not navigate away from the initial page under normal operation. Client-side API calls are made through the `pixl-xyapp` wrapper around `window.fetch`, and xyOps only uses HTTP `GET` and `POST` for its own REST APIs.

## Core Framework Modules and Why They Matter

### `pixl-server`

`pixl-server` is the top-level daemon and component framework. It manages component startup order, config loading, logging, daemon forking, shutdown, and shared server components.

Security relevance:

- config loading and overrides happen here and in xyOps helpers
- the component model explains why auth, API routing, storage, and web serving are not implemented in the conventional Express style

### `pixl-server-api`

`pixl-server-api` maps URIs to methods by namespace and prefix. xyOps registers its app APIs with:

- namespace: `app`
- function prefix: `api_`

Security relevance:

- names are normalized to lowercase alphanumeric, slash, dash, and dot
- namespaced dispatch only invokes functions that actually exist on the target object
- for xyOps app APIs, only methods prefixed with `api_` are routable

This is the reason a generic claim like "malformed URI can invoke arbitrary server methods" is likely a false positive unless an auditor can show a real dispatch bypass in `node_modules/pixl-server-api/api.js` or xyOps registration logic in `lib/api.js`.

### `pixl-server-web`

This replaces Express and similar frameworks. It handles listeners, request parsing, uploads, static files, responses, queueing, limits, timeouts, ACLs, and both HTTP and HTTPS.

Security relevance:

- static file paths are resolved against the web root and rejected if they resolve outside it
- request body and upload size limits are enforced here
- connection limits and request queue limits live here
- response headers, including browser security headers, are configurable here

### `pixl-server-user`

This provides the base local auth system: user creation, login, password reset, sessions, cookies, CSRF, password hashing, and related APIs.

xyOps extends it with hooks in `lib/engine.js` for roles, extra user data, login/logout behavior, and audit logging.

Security relevance:

- bcrypt password hashing is enabled by default
- CSRF is enabled by default
- session IDs and CSRF tokens are cryptographically generated
- usernames are regex-restricted and blocked from unsafe/reserved JS object keys
- failed login attempts and forgot-password attempts are rate limited per account
- cookie mode is enabled by default in xyOps

### `pixl-server-storage`

This is the storage abstraction under nearly all persistent state in xyOps. It supports multiple backends, including Filesystem, SQLite, Redis, S3, and hybrids.

Security relevance:

- it is a storage key/value system, not direct filesystem path concatenation
- storage keys are normalized centrally
- path traversal assumptions that apply to ad hoc filesystem path joins generally do not apply here

### `pixl-server-unbase`

This is the database-like query layer on top of storage indexes. xyOps uses it for searchable record sets such as jobs, alerts, tickets, and other entities.

Security relevance:

- search queries are query-language input to the indexer, not SQL and not executable code
- search is logically read-only
- record insert/update/delete happens through separate write APIs

### `pixl-xyapp`

This is the client-side framework. It provides SPA state, routing, utilities, and the REST API wrapper.

Security relevance:

- adds `X-CSRF-Token` automatically to `POST` requests when `app.csrf_token` is present
- stores the CSRF token in runtime memory on the global `app` object
- does not persist the CSRF token to `localStorage` or `sessionStorage`

## Trust Assumptions

The following are trusted by design unless explicitly stated otherwise:

- the Node.js runtime and host OS
- the PixlCore first-party framework modules listed above
- the local admin who can edit `config.json`, `overrides.json`, system hooks, plugins, web hooks, and marketplace installs
- the reverse proxy or auth gateway in front of SSO deployments
- the remote server operator for any xySat satellite they provision

The following are not trusted:

- browser users unless authenticated and authorized
- external API callers unless authenticated by session or API key
- arbitrary uploaded files and job output
- HTTP request bodies, query strings, headers, and JSON payloads
- remote web hook destinations
- any expression, template, plugin parameter, or action text supplied by a non-admin user in a surface they are allowed to edit

## Threat Actors

### Unauthenticated internet or network attacker

Capabilities:

- send arbitrary HTTP/HTTPS requests
- attempt login abuse, CSRF, path traversal, header manipulation, malformed API paths, upload abuse, or WebSocket misuse

Key review areas:

- auth boundaries
- CSRF
- request parsing
- static file serving
- connection and upload limits
- cookie behavior

### Authenticated non-admin user

Capabilities:

- use normal UI and API features allowed by their privileges
- create and edit a limited set of records by default
- run jobs manually if granted

Key review question:

- can a basic user cross into admin-only features such as plugins, web hooks, secrets, config, API keys, or server enrollment?

### Authenticated admin

Capabilities:

- define plugins, system hooks, web hooks, secrets, config overrides, server enrollment, and marketplace installs

Important note:

- admin-controlled command execution, web request generation, templating, Docker invocation, and similar power features are generally by design
- a finding here is only meaningful if there is an unexpected trust-boundary break, secret leak, privilege escalation, or unsafe default that defeats documented controls

### Misconfigured or compromised SSO proxy

Capabilities:

- send forged trusted headers to xyOps

Important note:

- xyOps trusted-header SSO assumes the upstream proxy is trusted and IP-restricted
- direct reachability to xyOps from untrusted clients in an SSO deployment is a deployment flaw, not necessarily an application auth bypass

### Compromised satellite or conductor peer

Capabilities:

- attempt to authenticate with server-to-server tokens
- send job updates, monitoring data, or peer control traffic if successfully authenticated

Key review areas:

- token derivation
- replay and reuse boundaries
- secret key distribution and rotation
- what actions are allowed after auth

## Trust Boundaries

1. Browser to conductor HTTP(S)
   - login, session resume, API calls, file downloads, magic link flows

2. Browser to conductor WebSocket
   - authenticated real-time updates, job log watching, page updates

3. External API client to conductor REST API
   - authenticated by session or API key

4. Conductor to storage and Unbase
   - persistent state, sessions, secrets, job files, logs, indexes

5. Conductor to outbound destinations
   - web hooks, email, release metadata fetches, marketplace metadata, satellite bundle downloads, optional admin-configured HTTP features

6. Satellite to conductor WebSocket and bootstrap APIs
   - provisioning, persistent server auth, job updates, monitoring data

7. Conductor to peer conductor
   - master registration, failover election, config override transport, cluster control

8. Conductor to local filesystem
   - config files, logs, temp files, plugin binaries, crash/background logs

9. Conductor to plugin execution environment
   - secrets become env vars, files become inputs, UID/GID may change, subprocesses may run on remote satellites or locally depending on plugin type

## Security Model by Subsystem

### HTTP and API Routing

Key files:

- `lib/engine.js`
- `lib/api.js`
- `node_modules/pixl-server-api/api.js`
- `node_modules/pixl-server-web/lib/static.js`

Behavior:

- xyOps registers its app APIs through `this.api.addNamespace("app", "api_", this)` in `lib/api.js`.
- `pixl-server-api` normalizes API names and only dispatches to matching handler methods that actually exist on the target object.
- Static files are served by `pixl-server-web`, which resolves the request path relative to the configured `htdocs_dir` and rejects paths that resolve outside the base directory.

Auditor guidance:

- Do not assume Express-style router bugs.
- If claiming arbitrary method invocation through a crafted URL, show a concrete path that bypasses `normalizeAPIName()`, namespace matching, and the `api_` prefix restriction.
- If claiming path traversal to arbitrary host files, show a path that defeats `Path.resolve()` plus the base-dir prefix check in `node_modules/pixl-server-web/lib/static.js`.

### Local User Authentication

Key files:

- `node_modules/pixl-server-user/user.js`
- `lib/engine.js`
- `sample_conf/config.json`

Behavior:

- Password hashing uses bcrypt by default.
- On login, the module performs password comparison even when the user does not exist, to reduce timing leaks.
- Failed logins are tracked per user per hour, with account lockout after the configured threshold.
- Forgot-password initiation is rate limited per user per hour.
- Sessions are stored in storage as `sessions/SESSION_ID`.
- xyOps config enables cookie mode, bcrypt, and CSRF by default.

Security-relevant defaults in xyOps:

- `User.use_bcrypt: true`
- `User.use_csrf: true`
- `User.max_failed_logins_per_hour: 5`
- `User.max_forgot_passwords_per_hour: 3`
- cookie settings:

```json
"cookie_settings": {
	"path": "/",
	"secure": "auto",
	"httpOnly": true,
	"sameSite": "Lax"
}
```

Auditor guidance:

- Passwords are not stored in plaintext.
- `secure: "auto"` means cookies are only marked `Secure` when the request is detected as secure. A production deployment still needs proper TLS or trusted TLS termination.
- Session lifetime is configuration-driven. If reviewing long-lived sessions as a policy risk, distinguish that from a technical auth bypass.

### Session Management, Cookies, and CSRF

Key files:

- `node_modules/pixl-server-user/user.js`
- `lib/api.js`
- `node_modules/pixl-xyapp/js/base.js`

Behavior:

- Session IDs are 64-hex-character cryptographically generated tokens.
- CSRF tokens are also cryptographically generated and stored in the session.
- For non-`GET` and non-`HEAD` requests, `loadSession()` enforces CSRF token validation when enabled.
- The SPA client automatically sends `X-CSRF-Token` on `POST`.
- xyOps scrubs session IDs and CSRF tokens from params, cookies, and headers after session load to reduce accidental logging and parameter bleed-through.

Auditor guidance:

- A claim of missing CSRF on normal state-changing APIs should be proven against actual code paths, not assumed from the absence of a popular middleware package.
- Future auditors should especially verify any API handler that bypasses `loadSession()` or explicitly sets `skip_csrf`.

### API Keys

Key files:

- `lib/api.js`
- `lib/api/apikey.js`
- `docs/api.md`

Behavior:

- Only administrators can create, update, or delete API keys.
- The plaintext API key secret is generated server-side and returned once at creation time.
- xyOps stores only a salted SHA-256 digest of the API key, using the key ID as the salt component: `sha256(plain_key + key_id)`.
- API keys carry their own privilege set and can also inherit roles.
- API key sessions are simulated internally and rate-limited by `max_per_sec` when configured.
- Incoming API key values are scrubbed from common request locations after authentication.

Important current-code note:

- The current code generates API key secrets with `Tools.generateUniqueBase64()`, which produces URL-safe base64 output and is typically about 43 characters long.
- Auditors should trust the code path in `lib/api/apikey.js` over any stale length references in older docs.

Auditor guidance:

- Do not report "API key stored in database" as a vulnerability unless plaintext recovery is possible.
- A meaningful finding would require something like digest forgery, privilege mis-enforcement, leaked plaintext after creation, or key reuse in logs or broadcasts.

### SSO via Trusted Headers

Key files:

- `lib/sso.js`
- `docs/sso.md`
- `sample_conf/sso.json`

Behavior:

- xyOps supports SSO by trusting headers from an upstream auth gateway.
- SSO can be IP-restricted with a whitelist.
- xyOps maps configured headers into local user fields, optionally cleans up username/full name, synchronizes roles and privileges from group mappings, and then creates its own local session cookie.
- SSO still uses the normal xyOps session model after successful login.

Threat model implications:

- The critical trust boundary is between xyOps and the reverse proxy.
- xyOps assumes the proxy strips user-controlled copies of the trusted headers and only forwards validated headers from the identity layer.
- If xyOps is reachable directly by untrusted clients while SSO trusted headers are enabled, impersonation risk exists by design.

Auditor guidance:

- Do not report "header-based auth can be spoofed" as a product vulnerability unless you can show xyOps accepts those headers from untrusted network sources despite the documented IP-restriction model.
- Real findings in this area would include whitelist bypass, header-map abuse despite whitelist, or privilege synchronization bugs that exceed mapped groups.

### Privileges, Roles, and Resource-Level Restrictions

Key files:

- `docs/privileges.md`
- `lib/api.js`
- `lib/engine.js`
- `sample_conf/config.json`

Behavior:

- Effective privileges are the union of direct privileges and role-derived privileges.
- `admin` bypasses normal privilege checks.
- xyOps also applies resource-level constraints for categories, server groups, and targets.
- New local or SSO-created users receive a limited default privilege set, not full plugin or web hook power.

Default user privileges in sample config:

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

Auditor guidance:

- Many "command injection" or "SSRF" claims are noise unless a non-admin or unexpected low-privilege user can reach the underlying feature.
- Always trace privilege checks at the API boundary, then any category/group/target checks deeper in the flow.

### Admin-Locked Plugin Fields

Key files:

- `internal/setup.json`
- `docs/plugins.md`
- `docs/scaling.md`

Behavior:

- Plugin parameter definitions can mark fields as `locked`, meaning only administrators may edit them.
- This is important because several built-in power features ship admin-locked by default.

Examples:

- Shell Script plugin: `script` is locked by default.
- HTTP Request plugin: `url` is locked by default.
- Docker Run plugin: several execution-critical fields are locked by default, including image name, image version, command extras, launch command, and script source.

Threat model implications:

- Out-of-the-box, a basic user cannot simply type arbitrary shell, arbitrary outbound URLs, or arbitrary Docker image/command settings unless an administrator explicitly grants broader power.

Auditor guidance:

- Do not treat the mere presence of shell execution or arbitrary URL fetch features as a bug.
- Focus on whether a lower-privilege user can alter a locked field, create a plugin despite missing privileges, or smuggle execution data through some other writable field.

### Global Secret Key

Key files:

- `sample_conf/config.json`
- `sample_conf/overrides.json`
- `lib/api/admin.js`
- `lib/util.js`
- `bin/container-start.sh`
- `bin/build-tools.js`
- `bin/control.sh`

Behavior:

- xyOps uses a single global `secret_key`.
- It is generated automatically on first install.
- In normal installs it lives in `conf/overrides.json`, not hardcoded in source.
- Config and override files are forced to owner read/write (`chmod 600`) on startup in the control scripts, and override writes also use mode `0600`.
- The secret key is never sent to clients.
- The config APIs strip `secret_key`, `SSO`, and `Debug` from admin config responses.
- Config update APIs refuse updates to reserved keys such as `secret_key`.

The secret key is used for:

- encrypting secret vaults
- generating satellite auth tokens
- generating conductor peer auth digests
- generating magic-link stream tokens
- generating download tokens
- encrypting config override transport between conductors

Rotation:

- Secret key rotation is an orchestrated admin action.
- It requires an authenticated admin session and password re-entry.
- The rotation process disables the scheduler if needed, flushes queued jobs, aborts active jobs, waits for them to finish, re-encrypts secrets, reissues server auth tokens, and updates shared config overrides for peers.

Auditor guidance:

- Do not treat derived tokens as standalone secrets independent of the secret key.
- A real finding would be disclosure of the secret key, improper transport of it, ability to update it without admin/password re-verification, or forgery of derived tokens without knowledge of it.

### Encrypted Secret Vaults

Key files:

- `lib/secret.js`
- `lib/api/secrets.js`
- `docs/secrets.md`

Behavior:

- Secret vault values are stored separately from metadata.
- Secret metadata is plaintext and includes IDs, titles, notes, variable names, and assignments.
- Secret values are encrypted at rest with AES-256-GCM.
- Key derivation uses scrypt with per-record random salt.
- Each record has a random 96-bit IV.
- The secret ID is bound as AAD to prevent record swapping.
- Secrets are decrypted only when needed at runtime.
- Secret accesses are logged, with routine use in the `Secret` log and admin decrypt operations in the main activity log.
- Secret variable names are blocked from unsafe object keys using `Tools.MATCH_BAD_KEY`.

Threat model implications:

- The secret boundary depends directly on protection of the global `secret_key`, admin privileges, and correct assignment enforcement.
- Job and web hook runtime surfaces that receive secrets are intentionally powerful and should be reviewed for downstream leakage, not mistaken for storage-layer weaknesses.

Auditor guidance:

- Do not report "secret metadata visible" as a vault failure unless values themselves are exposed.
- Review:
  - admin-only decrypt APIs
  - secret assignment enforcement
  - runtime leakage to logs, UI, exports, or debug paths

### WebSockets

Key files:

- `lib/comm.js`
- `lib/multi.js`
- `htdocs/js/comm.js`

xyOps uses three important WebSocket classes.

#### Browser client to conductor

Behavior:

- Browser sockets connect over the same HTTP(S) listener as the app.
- Authentication uses the existing session cookie; the browser sends it automatically as part of the WebSocket upgrade request.
- The server extracts `session_id` from the cookie and calls the normal session loader.
- Unauthenticated sockets are closed after 30 seconds.
- Authenticated user sockets are used mainly for notifications, page updates, job log watching, and similar real-time views.

Auditor guidance:

- Review actual allowed commands after authentication, not just transport establishment.
- A real issue would be an unauthenticated command path or a privilege boundary break on an authenticated socket command.

#### Satellite to conductor

Behavior:

- The satellite first says hello, receives a nonce and possibly a newly assigned server ID, then authenticates.
- Current server auth accepts either:
  - `sha256(nonce + secret_key)` for the challenge flow
  - `sha256(server_id + secret_key)` for the persistent auth token flow
- Existing stale sockets for the same server ID are closed on successful auth.
- The conductor pushes satellite config, airgap config, event plugins, and monitor commands after successful join.

Threat model implications:

- The security here is rooted in secrecy of `secret_key` and correctness of server ID issuance and tracking.
- A leaked server ID alone is insufficient without the secret key.

Auditor guidance:

- Do not report replay merely because a deterministic token path exists. Show a concrete replay path that succeeds without possession of the secret key.

#### Conductor peer to conductor peer

Behavior:

- Peer discovery and registration use `sha256(host_id + secret_key)`.
- Peer WebSocket auth also uses host ID plus shared secret-derived digests.
- Election is based on connectivity plus lexical hostname ordering.
- Config overrides are encrypted for peer transport.

Auditor guidance:

- Focus on whether an untrusted host can join as a peer without the shared secret, or whether peer control commands can be injected without an authenticated socket.

### Satellite Bootstrap and Other Auth Tokens

Key files:

- `lib/api/satellite.js`
- `lib/api/jobs.js`
- `lib/api/file.js`
- `lib/api/events.js`
- `lib/api/search.js`

xyOps uses several different token types. Auditors should not conflate them.

#### Transfer tokens

- Used for satellite bootstrap.
- Randomly generated in memory with an expiry.
- Used to fetch install script and initial config.

#### Persistent satellite auth tokens

- Derived as `sha256(server_id + secret_key)`.
- Embedded into generated satellite config.

#### Job stream tokens

- Derived as `sha256('stream' + job_id + secret_key)`.
- Used for magic-link job SSE streaming.

#### Download tokens

- Derived from the job ID and secret key.
- Used for tokenized download or search-result links to job artifacts.

Threat model implications:

- Some of these tokens appear in query strings or generated URLs by design.
- Whether that is acceptable depends on transport and deployment context.
- In particular, satellite bootstrap URLs are intended for internal server-to-server use, not normal browser navigation over the public internet.

Auditor guidance:

- Do not report "token in URL" as automatically high severity.
- Instead, review:
  - token lifetime and scope
  - whether the token grants only the intended capability
  - whether logs, referrers, or browser history are actually in play for that flow
  - whether production guidance expects TLS

### Web Hooks, Channels, and Outbound HTTP

Key files:

- `lib/api/webhook.js`
- `lib/action.js`
- `docs/webhooks.md`
- `docs/syshooks.md`

Behavior:

- Web hooks are outbound HTTP requests triggered by jobs, alerts, or system events.
- Only appropriately privileged users may create or edit them.
- Default installs do not grant web hook privileges to basic users.
- Web hook definitions are shared configuration and are visible to authenticated users. This includes literal values stored in the URL, headers, and body.
- The web hook privileges control creation, editing, deletion, and testing. They do not establish a read-confidentiality boundary for the definition.
- Web hook URL, headers, and body support `{{ ... }}` expression expansion using xyOps data context.
- Sensitive credentials should be stored in a Secret Vault and referenced with expressions such as `{{ secrets.API_TOKEN }}`. Literal credentials placed directly in a web hook definition are not protected as secrets.
- Optional features include redirects, retries, timeout control, and TLS verification bypass.
- Hook execution records detailed request/response/timing diagnostics.
- Notification channels may wrap web hooks as one delivery mechanism among others.

Threat model implications:

- A web hook that an administrator points at an internal hostname, `localhost`, or metadata IP is not automatically an SSRF vulnerability. It is often the intended purpose of the feature.
- The correct question is who can configure the destination, and whether outbound restrictions such as airgap are functioning as intended.
- Authenticated visibility of literal web hook configuration is expected behavior. Secret Vault values remain a separate security boundary and must not be disclosed through definition APIs or routine client data.

Auditor guidance:

- Treat outbound request features as admin-controlled capability surfaces first.
- Do not treat a literal credential placed directly in a web hook URL, header, or body as a Secret Vault disclosure. Verify whether an actual Secret Vault value crosses an unintended boundary.
- A real issue would be:
  - non-admin access to hook creation or editing
  - template evaluation leaking Secret Vault values to an unauthorized user or client surface
  - privilege bypass allowing a low-privilege user to trigger a privileged hook unexpectedly
  - outbound restriction bypass where policy is supposed to apply

### HTTP Request Plugin

Key files:

- `internal/setup.json`
- `docs/plugins.md`
- `docs/scaling.md`

Behavior:

- The built-in HTTP Request plugin can issue outbound HTTP requests from job execution contexts.
- The URL field is administrator-locked by default.
- Custom headers, body data, and regex response matching are supported.
- This is an intended power feature and can be used to reach internal services if an administrator allows it.

Auditor guidance:

- Do not label this as SSRF merely because it can reach arbitrary destinations.
- Focus on whether basic users can modify the destination or otherwise influence privileged outbound requests unexpectedly.

### System Hooks

Key files:

- `docs/syshooks.md`
- `sample_conf/config.json`

Behavior:

- System hooks are global admin-defined automations configured in `config.json`.
- They can send mail, fire web hooks, create tickets, or run shell commands in response to system activity.
- Only someone with config-file control or admin config control can define them.

Threat model implications:

- Admin-controlled shell execution here is not a vulnerability by itself.
- The real boundary is whether a lower-privilege user can write system hooks or inject unexpected data into them in a way that breaks documented security assumptions.

### Storage, Database, Uploads, and File Serving

Key files:

- `node_modules/pixl-server-storage/storage.js`
- `node_modules/pixl-server-storage/docs/Indexer.md`
- `node_modules/pixl-server-unbase/main.js`
- `lib/api/file.js`
- `lib/api/search.js`

Behavior:

- Storage keys are normalized centrally by `pixl-server-storage`.
- The storage layer is not ordinary filesystem path concatenation, even when backed by the filesystem engine.
- File uploads sanitize filenames with `Path.basename()` plus safe-character cleanup.
- Download and search-result flows use secret-derived tokens for tokenized access where needed.
- HTML-capable uploads may be forced to download rather than execute inline, depending on response path.
- Unbase search is an index query system, not SQL, and query input is not executable code.

Auditor guidance:

- Do not report classic `../` path traversal against storage-backed keys without showing a real escape from the storage abstraction.
- Do not report "database injection" unless you can show query input writing, mutating, or executing code beyond the documented read-only search behavior.

### Expression Language: xyOps Expression Format (XYEXP / JEXL)

Key files:

- `docs/xyexp.md`
- `lib/util.js`
- `lib/workflow.js`
- `lib/api/webhook.js`

Behavior:

- xyOps uses JEXL, not JavaScript `eval`, for expressions and `{{ ... }}` template expansions.
- xyOps adds a number of helper functions for formatting and utility logic.
- Expressions are evaluated against explicit context objects.
- Web hook bodies are syntax-checked on create and update.

Threat model implications:

- JEXL expressions are intended user/admin content in multiple subsystems.
- A scanner claiming "expression injection" must prove breakout from the JEXL evaluator or access to objects outside the provided context, not merely the existence of expression evaluation.

Auditor guidance:

- Do not treat use of `jexl.evalSync()` as equivalent to `eval()` or arbitrary JavaScript execution.
- Review:
  - what data context is exposed in each subsystem
  - whether secrets appear in that context
  - whether expression outputs are later passed into more dangerous sinks without privilege checks

### Browser Security Headers and CSP

Key files:

- `sample_conf/config.json`
- `pixl-server-web` response header support

Behavior:

- The sample config uses `uri_response_headers` to apply CSP and other browser security headers to HTML routes.
- The default CSP is restrictive and includes `default-src 'none'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, and other hardening headers.

Important nuance:

- HSTS is not enabled by default in sample config.
- HTTPS is enabled in sample config but not forced by default.
- This is a deployment hardening choice, not an application auth bypass by itself.

Auditor guidance:

- Distinguish missing or optional hardening headers from actual exploitable XSS or clickjacking flaws.
- If reporting browser policy weaknesses, verify the running config rather than assuming defaults.

### Debug Component

Key files:

- `node_modules/pixl-server-debug/README.md`
- `node_modules/pixl-server-debug/debug.js`
- `sample_conf/config.json`

Behavior:

- The debug component is disabled by default.
- It can be enabled via config or environment override.

Auditor guidance:

- Treat exposed debug tooling as a deployment/config exposure, unless a non-admin path enables it unexpectedly.

## Production Hardening Assumptions

xyOps is designed to work out of the box, but secure production posture still depends on deployment choices. Auditors should review:

- whether TLS is enabled and, if applicable, forced
- whether `https_header_detect` is correct behind reverse proxies
- whether inbound IP restrictions are configured on the web server or upstream proxy
- whether SSO trusted-header mode is only reachable from the auth proxy
- whether plugins run as underprivileged users/groups
- whether the Docker socket is mounted and who can use Docker-capable plugins
- whether outbound network restrictions such as airgap are enabled and effective
- whether secret/config files remain permissioned as owner-only
- whether the secret key has been rotated from its initial install value

These are often policy or deployment findings, not application-code vulnerabilities.

## Known Scanner Trapdoors

The following classes of findings are especially likely to generate noise in xyOps if the auditor does not account for privilege boundaries and intended features.

### "JEXL expression injection"

Usually noise unless:

- the expression evaluator can escape its context
- secrets or internal objects become reachable unexpectedly
- expression output later flows into a more privileged sink without proper boundary checks

### "Command injection in plugins"

Usually noise unless:

- non-admins can create or edit plugins or locked fields
- plugin parameters unexpectedly reach shell execution outside the documented plugin model
- secrets or cross-tenant data leak into a command path unexpectedly

### "SSRF via web hooks or HTTP Request plugin"

Usually noise unless:

- low-privilege users can control destinations they should not control
- airgap or outbound ACL features are documented as enforced but are bypassable
- secret material is sent unexpectedly to attacker-controlled endpoints

### "CORS wildcard vulnerability"

Usually noise unless:

- the deployment actually sends a permissive `Access-Control-Allow-Origin`
- credentials are allowed in a way that makes a concrete cross-origin attack possible

The presence of a preflight handler alone is not sufficient.

### "SSO header spoofing"

Usually deployment noise unless:

- trusted headers are accepted from untrusted IPs
- the SSO whitelist can be bypassed
- xyOps itself mis-handles the trusted-header contract

### "Path traversal in storage paths"

Usually noise unless:

- the finding defeats storage key normalization or the web root prefix check
- the path escapes the storage abstraction into arbitrary host filesystem access

### "Docker runs as root" or "Docker socket exposure"

Usually deployment and admin-power noise unless:

- a low-privilege user can access Docker-capable features unexpectedly
- privilege boundaries are crossed despite plugin privilege controls

### "Tokens in URL query strings"

Needs context. Review:

- whether it is a browser flow or server-to-server flow
- whether the token is short-lived or capability-scoped
- whether TLS is expected
- whether logging, referrer, or browser history actually apply to the specific flow

## Areas Especially Worth Auditing

This section points auditors toward places where a real finding would be high-value.

### Auth boundary bypasses

Inspect:

- any API that does not call `loadSession()`
- any API that accepts tokens in multiple ways
- any flow that falls back from session auth to token auth
- any `skip_csrf` usage

### Privilege boundary mistakes

Inspect:

- admin-only APIs in `lib/api/*.js`
- plugin and web hook edit flows
- secret decrypt and config APIs
- category/group/target enforcement around job access and file access

### Secret leakage

Inspect:

- logs, activity records, and job details for accidental plaintext secret output
- secret assignment flows for over-broad access
- web hook diagnostics that may accidentally include expanded Secret Vault values from headers, URLs, or bodies
- export/import paths

### Token scope and replay

Inspect:

- satellite bootstrap tokens
- persistent satellite tokens
- stream/download tokens
- peer auth digests

### WebSocket command surface

Inspect:

- allowed commands before auth
- command authorization after auth
- privilege changes while sockets are open
- stale socket handling after user disable/delete or privilege changes

### Outbound policy enforcement

Inspect:

- web hook execution
- HTTP Request plugin execution
- marketplace metadata or release fetches
- any airgap or allowlist/denylist enforcement paths

## Suggested Audit Workflow

1. Read this document and `README.md`.
2. Read `docs/dev.md` and the local READMEs for `pixl-server-*`, `pixl-xyapp`, and `pixl-tools`.
3. Trace request ingress:
   - `pixl-server-web`
   - `pixl-server-api`
   - `lib/engine.js`
   - `lib/api.js`
4. Trace authentication:
   - `pixl-server-user/user.js`
   - `lib/sso.js`
   - `lib/api/apikey.js`
5. Trace secrets and config:
   - `lib/secret.js`
   - `lib/api/secrets.js`
   - `lib/api/config.js`
   - `lib/api/admin.js`
6. Trace real-time channels:
   - `lib/comm.js`
   - `lib/multi.js`
   - `htdocs/js/comm.js`
7. Trace outbound execution surfaces:
   - `lib/action.js`
   - `lib/api/webhook.js`
   - `internal/setup.json`
8. Only then run targeted scanning or deeper manual review.

## Final Notes for Auditors

The fastest way to generate noise in xyOps is to mistake administrator-controlled automation features for attacker-controlled bugs. The fastest way to miss real issues is to trust that documentation and code are always perfectly aligned. A strong audit of xyOps should therefore do both of these things at once:

- respect the documented privilege model and intended power features
- verify that the implementation actually enforces the documented trust boundaries

That is the standard this document is meant to support.
