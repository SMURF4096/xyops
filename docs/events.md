# Events

## Overview

Events are the core building block of xyOps. An event describes what to run (a Plugin with parameters), where to run it (one or more target servers or groups), when to run it (Triggers), and how to constrain and react to runs (Limits and Actions). Each time an event "runs" it launches a job. Jobs have full lifecycle state, logs, metrics, limits, and actions.

## Key Points

- An event is a saved configuration for launching jobs. It has an `id`, `title`, `category`, `plugin`, `params`, optional `fields`, `tags`, `targets`, `algo`, `triggers`, `limits`, and `actions`.
- When a trigger fires (schedule, interval, single-shot, plugin, or manual), the scheduler creates a job from the event and launches it on a chosen target server.
- Category defaults apply automatically: category-defined actions and limits are merged into the job in addition to any defined on the event. System "universal" defaults may also apply.
- Jobs run code provided by an Event Plugin on the selected server, stream logs back to the UI, update metrics, and honor configured limits and actions.
- Workflows are a special kind of event that launch a graph of nodes; they use a special workflow pseudo-plugin. See [Workflows](workflows.md).

## Creating and Editing Events

You can create and edit events in the Events page of the UI or via the API. The minimum you typically need:

- `title`: Human-friendly name, displayed in the UI.
- `category`: Controls access and provides default actions/limits. See [Categories](categories.md).
- `plugin`: The Event Plugin that runs the job code (not required for workflow events).  See [Event Plugins](plugins.md#event-plugins).
- `targets`: One or more servers and/or groups where jobs may run.
- `algo`: Server selection algorithm when multiple targets are available (default is random).
- `params`: Plugin parameters passed to your job. Locked parameters may be enforced by admins or categories.
- `fields`: Optional user-defined parameters that are prompted when launching manually, then merged into params.
- `tags`: Labels that help searching and filtering job history.  See [Tags](tags.md).
- `triggers`: One or more entries that determine run timing and rules.  See [Triggers](triggers.md).
- `limits`: Self-imposed resource constraints for the job to follow.  See [Limits](limits.md).
- `actions`: Optional per-event notifications/chaining behavior.  See [Actions](actions.md).

## How Events Run

Running an event produces a job. Here is the lifecycle from trigger to execution:

1. **Trigger fires**
	- The scheduler evaluates all event triggers once per minute (with optional second precision) and emits launches when conditions match.
	- Manual runs from the UI/API also count as launches. 
2. **Job object is created**
	- The job starts as a copy of the event plus trigger context and any user/API overrides. 
	- It is assigned a unique `job.id`, and `job.event` is set to the event's ID. 
	- Category-defined actions/limits and system defaults are merged in. 
3. **Parameters resolved**
	- `event.params` and any prompted `fields` are merged and can use `{{ macros }}` that resolve against the job context.  See [Parameter Macro Expansion](#parameter-macro-expansion) for details and examples.
4. **Target selection**
	- The system collects candidate servers from targets (servers and/or groups), filters to enabled, online servers, and optionally removes servers under active job-limiting alerts. 
	- If no servers are available, a queue limit (if configured) may place the job in a queue; otherwise the job aborts and may be eligible for retry. 
	- Details on server algorithms appear below.
5. **Plugin execution**
	- Once a server is chosen, the job is dispatched to that server's xySat agent and the Event Plugin runs with the final parameters and environment. 
	- Output streams into the job log; CPU/memory/IO metrics are sampled for limits and history. 
	- See [Event Plugins](plugins.md#event-plugins) for plugin anatomy and execution details.
6. **Limits and actions**
	- Active limits (time, log size, CPU, memory, etc.) are continuously evaluated. 
	- When exceeded, configured actions fire (email, web hooks, tags, snapshots, abort, etc.).
7. **Completion**
	- On finish, final actions run (success/fail/progress/abort, plus any tag-based actions), and the job record is stored in history for searching and analytics.

## Triggers

Triggers define when jobs are allowed to launch, and optional modifiers. Common patterns:

- `manual`: Allows on-demand runs via UI/API. If omitted or disabled, manual runs are rejected.
- `schedule`: Cron-style arrays of years/months/days/weekdays/hours/minutes with optional timezone.
- `interval`: Run every N minutes; mutually exclusive with precision/delay.
- `single`: One-time run at a specific date/time.
- `plugin`: Scheduler Plugin decides when to run; useful for external signals.
- Modifiers: `catchup`, `nth`, `range`, `blackout`, `delay`, `precision` provide windowing, lockouts, and sub-minute behavior.

See the full trigger list and composition rules: [Triggers](triggers.md).

## Server Selection

The `targets` list may contain server IDs and/or group IDs. At launch time xyOps:

- Expands groups into member servers and de-duplicates the list.
- Filters to currently enabled, online servers.
- Optionally removes servers that are under active blocking alerts (e.g. maintenance or capacity limits).
- Optionally applies a [Target Expression](#target-expressions) to further reduce the list (see below).
- If the resulting set is empty, and a `queue` limit is present, the job may enter a per-event queue up to the configured size; otherwise it aborts with a retry-ok flag.

Selection among remaining candidates is controlled by `algo`:

- `random`: Choose randomly among candidates.
- `round_robin`: Cycle through candidates in order, persisting position between runs.
- `least_cpu`: Choose the server reporting the lowest CPU load.
- `least_mem`: Choose the server reporting the lowest active memory.
- `fewest_jobs`: Pick the server with the fewest active jobs.
- `prefer_first_natural` / `prefer_last_natural`: Prefer first/last by the natural order in the [Event.targets](data.md#event-targets) list.
- `prefer_first` / `prefer_last`: Prefer first/last by label or hostname sort for stability.
- `monitor:_ID_`: Choose the server with the smallest current value of a specific monitor.

The chosen server ID is stored on the job as `server` and the server's group memberships are copied into `groups` for analytics.

### Target Expressions

Events can include an optional "target expression" to further reduce the set of candidate servers to run jobs.  The expression is applied to each server in the matched set generated by the [Event.targets](data.md#event-targets) list, and if it evaluates to `false`, the server is eliminated from the candidate pool.

The expression should be in [xyOps Expression Format](xyexp.md), and the context is the [Server](data.md#server) object itself (so you can directly reference all properties within it).  Here is an example:

```js
info.arch == "arm64" && info.cpu.cores >= 4
```

This would reduce the candidate servers to only those with ARM64 architecture, and 4 or more CPU cores, using the [Server.info](data.md#server-info) sub-object.

One common use case for this feature is to apply the target expression to properties in the [Server User Data](servers.md#user-data) object.  Example:

```js
userData.foo == "bar"
```

### Custom Job Weight

You can set an optional "job weight" per event, which is used when selecting a server to run a job.  This is designed to compliment [Max Jobs Per Server](servers.md#max-jobs-per-server), and allows you to limit how many jobs can run on specific servers based on their weight.

As an example, say you have a job that is particularly "heavy", like a video conversion script using ffmpeg.  You can set the weight to something high like `8`, and this effectively treats the job as taking up 8 "slots" when calculating server availability and the "max jobs" server setting.

If a new job would exceed the "max jobs" setting on a server, that server is removed from consideration (just as if it was otherwise unavailable or offline).  If a server's "max jobs" is less than the job weight, it will never be chosen for that job.

By default all jobs have a weight of `1`.  To set a job weight higher, edit the [Max Jobs Limit](limits.md#max-jobs-limit) on the event (or attach a [Limit Node](workflows.md#limit-nodes) in your workflow), and in the dialog you will see a new "Server Job Weight" field.  Note that this weight is **only** used for server selection, and does not affect the job's own concurrent maximum setting.

### Group Priority Targeting

The [prefer_first_natural](data.md#event-algo) event algorithm can be used in conjunction with [Max Jobs Per Server](servers.md#max-jobs-per-server) feature to effectively implement group priority targeting.  When an event is targeted at multiple groups, and `prefer_first_natural` is selected, the first group of servers will be preferred, *until* they cannot be (i.e. via max jobs per server limits), and only then will the second group will be considered.

Remember that the max jobs setting on servers will effectively "remove" the server from consideration when it is filled up (or cannot fit the new job based on its [weight](#custom-job-weight)).  With `prefer_first_natural` this will pick the very next server in the group, until all those servers are maxed out (i.e. unavailable for further jobs), and only then will the additional groups be considered.

Note that you can control the order in which groups are sorted inside of the [Event.targets](data.md#event-targets) list by going to the "Groups" page and dragging your groups around to resort them.  Groups higher on the list will appear first in the event target list.

### Priority Job Queuing

Jobs have an optional [Job.priority](data.md#job-priority) flag.  When this is set to `true` and [queuing](limits.md#max-queue-limit) is enabled on the event, the priority job will effectively "hop" the queue, and be inserted right at the head, so it is processed before all other non-priority jobs.

The priority flag can be set when a job is started manually, or via API.  For manual runs in the UI, the job configuration dialog will show a new "High Priority" checkbox, if [queuing](limits.md#max-queue-limit) is enabled on the event.  For API calls, when using the [run_event](api.md#run_event) API, simply include a `priority` property and set it to `true`.

When multiple priority jobs are queued for an event, the ones waiting the longest will be processed first (i.e. FIFO).  Once all the priority jobs are processed, the non-priority jobs are dequeued (also FIFO).

Note that you cannot set the priority flag via [Magic Link](triggers.md#magic-link) triggers (by design).

## Plugins

Every non-workflow event references an Event Plugin via `plugin`, which defines how to execute the job: command/script, user/group IDs, kill signals, and parameter definitions. The scheduler copies missing default parameter values from the plugin spec at launch time, and enforces locked/required parameters for non-admin users.

- **Parameters**: `params` are passed to the plugin. Locked/required attributes can be set by admins or categories. Optional `fields` collected at manual run time are merged into `params`.
- **Environment**: Jobs inherit configured `job_env` plus any event-specific `env` overrides.  Additionally, all Plugin params are passed as environment variables as well.
- **Input**: Jobs may include structured `input.data` and uploaded `input.files` when launched from the UI/API. Actions like "Bucket Fetch" can also populate inputs before your code runs.

See [Event Plugins](plugins.md#event-plugins) for plugin parameters, and lifecycle details.

### Parameter Macro Expansion

All string values in an event's `params` object support inline macro expansion using `{{ ... }}` syntax.  This includes regular Plugin parameter values, plus any user field values that are collected when manually launching the event, because those fields are merged into `params` before the job runs.

When these macros are evaluated, the context is the [Job](data.md#job) object itself.  This means you can reference job properties directly, without a `job.` prefix.  For example:

| Macro | Description |
|-------|-------------|
| `{{ id }}` | The current [Job.id](data.md#job-id). |
| `{{ event }}` | The [Event.id](data.md#event-id) that spawned the job. |
| `{{ server }}` | The selected [Server.id](data.md#server-id). |
| `{{ params.NAME }}` | A Plugin parameter or user field value named `NAME`. |
| `{{ workflow.params.NAME }}` | A workflow launch parameter, for sub-jobs inside workflows. |
| `{{ parent.job }}` | The parent job ID, when this job was launched by another job. |
| `{{ data.NAME }}` | A convenience alias for `input.data.NAME`, if input data was supplied. |
| `{{ files[0].filename }}` | A convenience alias for `input.files[0].filename`, if input files were supplied. |

This is only a quick list of common paths.  For the complete set of available properties, see the [Job](data.md#job) object reference.

The most common pattern is to reference one parameter from another.  For example, if your event has a user field named `region`, another text parameter can include it like this:

```text
Deploying to {{ params.region }}
```

Input data from workflows, API launches, and actions can also be inserted directly.  The full path is `input.data`, but xyOps also exposes `data` at the top level for convenience:

```text
Process account {{ data.account_id }} from {{ data.source }}
```

Similarly, input files are available as both `input.files` and `files`:

```text
First uploaded file: {{ files[0].filename }}
```

Macros use the same JavaScript-style expression syntax and helper functions described in [xyOps Expression Format](xyexp.md), so simple expressions are allowed as well:

```text
Retry attempt {{ retry_count + 1 }} for {{ params.target }}
```

## Limits

Limits constrain running jobs and optionally trigger actions. Common types include:

- `time`: Maximum wall clock duration.
- `log`: Maximum output size (bytes).
- `cpu` and `mem`: Sustained usage thresholds with grace periods.
- `queue`: Allow queuing when no targets are available, up to N jobs per event.

Limits can apply tags, send email/web hooks, generate snapshots, and abort jobs. Event limits combine with category defaults and universal limits. See docs/limits.md for complete reference and UI usage.

## Actions

Actions run at specific job lifecycle stages and conditions: `start`, `progress`, `success`, `warning`, `critical`, `abort`, `complete`, and tag-based triggers (`tag:xyz`). Actions can:

- Send email to users and/or custom addresses.
- Fire web hooks with rich job payloads.
- Run another event (chaining).
- Invoke an [Action Plugin](plugins.md#action-plugins).
- Store or fetch job files/data to/from [Storage Buckets](buckets.md).
- Create [Tickets](tickets.md), post to [Channels](channels.md), capture [Server Snapshots](snapshots.md), and more.

Event actions combine with category defaults and universal actions. See [Actions](actions.md) for all action types and configuration.

## Manual Runs and Prompts

To allow on-demand runs from the UI or API, include an enabled `manual` trigger on the event. When launching manually:

- Any `fields` defined on the event are presented as a UI form, and their values are merged into `params`.
- The UI/API may attach uploaded files; these become `input.files`. Arbitrary JSON may be provided as `input.data` when testing.
- Non-admin users must satisfy any locked/required parameters defined by the plugin or event fields; the system enforces these and applies defaults.

To run an event programmatically, see [API](api.md) for the run endpoint and parameter overrides.

## Permissions and Inheritance

- You must have privileges to create/edit events and to run jobs. The system enforces category and target privileges for all operations including history access where applicable.
- Category actions and limits are appended to the event at runtime. Universal actions/limits may also apply based on system configuration.

## Workflows

Workflow events are special "multi-event" graphs with connected nodes. Triggers on a workflow event define entry points into the graph. When launched, the workflow orchestrates sub-jobs and actions per node and connection. See [Workflows](workflows.md) for full details.

## Related Reading

- Event schema: [Event](data.md#event)
- Triggers: [Triggers](triggers.md)
- Plugins: [Plugins](plugins.md)
- Limits: [Limits](limits.md)
- Actions: [Actions](actions.md)
- API: [API](api.md)

## Example

Here is a trimmed example of an event in JSON format (see [Data Structures](data.md#event) for the complete version):

```json
{
  "id": "event100",
  "title": "Diverse heuristic complexity",
  "enabled": true,
  "category": "cat9",
  "plugin": "shellplug",
  "params": { "script": "#!/bin/bash\nsleep 30; echo HELLO;\n" },
  "targets": ["main"],
  "algo": "random",
  "triggers": [ { "type": "schedule", "enabled": true, "hours": [19], "minutes": [6] } ],
  "limits": [ { "type": "time", "enabled": true, "duration": 3600 } ],
  "actions": [ { "enabled": true, "condition": "error", "type": "email", "email": "admin@localhost" } ]
}
```

When the scheduled time hits, a job is created from this event, a server is chosen using the `random` algorithm among eligible targets, the `shellplug` plugin runs the script, and any limits/actions apply during the run.
