const assert = require('node:assert/strict');
const fs = require('fs');
const Tools = require('pixl-tools');

// helper: sleep
async function sleep(ms) {
	await new Promise(res => setTimeout(res, ms));
}

// helper: poll internal jobs until specified job id disappears
async function waitForJob(ctx, job_id, opts = {}) {
	const timeout = opts.timeout || 20000;
	const interval = opts.interval || 250;
	const start = performance.now();
	
	while (performance.now() - start < timeout) {
		let { data } = await ctx.request.json(ctx.api_url + '/app/get_active_jobs/v1', {});
		if (data.code !== 0) throw new Error('get_active_jobs failed');
		if (!data.rows.find(r => r.id === job_id)) return;
		await sleep(interval);
	}
	
	throw new Error('Timed out waiting for job to finish');
}

// helper: poll until xySat has taken ownership of a standard job
async function waitForRemoteJob(ctx, job_id, opts = {}) {
	const timeout = opts.timeout || 20000;
	const interval = opts.interval || 250;
	const start = performance.now();
	
	while (performance.now() - start < timeout) {
		let { data } = await ctx.request.json(ctx.api_url + '/app/get_active_jobs/v1', { id: job_id });
		if (data.code !== 0) throw new Error('get_active_jobs failed');
		let job = data.rows.find(function(row) { return row.id === job_id; });
		if (job && job.remote) return job;
		await sleep(interval);
	}
	
	throw new Error('Timed out waiting for remote job: ' + job_id);
}

// helper: poll until a specific job is suspended at the requested lifecycle phase
async function waitForSuspendedJob(ctx, job_id, opts = {}) {
	const timeout = opts.timeout || 20000;
	const interval = opts.interval || 100;
	const start = performance.now();
	
	while (performance.now() - start < timeout) {
		let { data } = await ctx.request.json(ctx.api_url + '/app/get_active_jobs/v1', { id: job_id });
		if (data.code !== 0) throw new Error('get_active_jobs failed');
		let job = data.rows.find(function(row) { return row.id === job_id; });
		
		if (job && job.suspended) {
			if (!('complete' in opts) || (!!job.complete === opts.complete)) return job;
		}
		await sleep(interval);
	}
	
	throw new Error('Timed out waiting for suspended job: ' + job_id);
}

// helper: wait for all jobs, with optional criteria
async function waitForAllJobs(ctx, opts = {}) {
	const timeout = opts.timeout || 20000;
	const interval = opts.interval || 250;
	const criteria = opts.criteria || {}; // e.g. state:queued
	const start = performance.now();
	
	while (performance.now() - start < timeout) {
		let { data } = await ctx.request.json(ctx.api_url + '/app/get_active_jobs/v1', criteria);
		if (data.code !== 0) throw new Error('get_active_jobs failed');
		if (!data.rows.length) return;
		if (opts.max_jobs && (data.rows.length > opts.max_jobs)) throw new Error('max_jobs exceeded: ' + data.rows.length);
		
		// DEBUG: log all unique state counts
		var states = {};
		data.rows.forEach( function(job) {
			states[ job.state ] = (states[ job.state ] || 0) + 1;
		} );
		// console.log( "JOB STATES: " + JSON.stringify(states) );
		
		if (opts.max_active_jobs) {
			var active_jobs = Tools.findObjects( data.rows, { state: 'active' } );
			if (active_jobs.length > opts.max_active_jobs) throw new Error('max_jobs exceeded: ' + active_jobs.length);
		}
		
		await sleep(interval);
	}
	
	throw new Error('Timed out waiting for all jobs to finish');
}

exports.tests = [
	
	async function test_create_web_hook_for_job(test) {
		// create new web hook that points back to our echo API
		let { data } = await this.request.json( this.api_url + '/app/create_web_hook/v1', {
			title: 'Job Test Web Hook',
			enabled: true,
			url: this.api_url + '/app/echo?jobby=1',
			method: 'POST',
			headers: [
				{ name: 'Content-Type', value: 'application/json' },
				{ name: 'User-Agent', value: 'xyOps/WebHook' }
			],
			body: '{\n  "text": "{{text}}",\n  "content": "{{text}}"\n}',
			timeout: 10,
			retries: 0,
			follow: false,
			ssl_cert_bypass: false,
			max_per_day: 0,
			notes: 'Created by unit tests'
		});
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( data.web_hook && data.web_hook.id, 'expected web_hook in response' );
		this.web_hook_id = data.web_hook.id;
	},
	
	async function test_create_category_for_job(test) {
		// create a final category for use by job tests
		let { data } = await this.request.json( this.api_url + '/app/create_category/v1', {
			"title": "Job Test Category",
			"enabled": true,
			"color": "plain",
			"notes": "For job",
			"actions": [
				{ enabled: true, condition: 'start', type: 'web_hook', web_hook: this.web_hook_id }
			],
			"limits": []
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.category && data.category.id, "expected category in response" );
		this.category_id = data.category.id;
	},
	
	async function test_create_event_for_job(test) {
		// create new event (non-workflow)
		let { data } = await this.request.json( this.api_url + '/app/create_event/v1', {
			"title": "Job Test Event",
			"enabled": true,
			"category": this.category_id, // inherit start action (web hook)
			"targets": ["main"],
			"algo": "random",
			"plugin": "shellplug",
			"params": { "script": "#!/bin/bash\necho hello\n", "annotate": false, "json": false },
			"limits": [ { enabled: true, type: 'time', duration: 60 } ],
			"actions": [ { enabled: true, condition: 'success', type: 'email', users: ['admin'] } ],
			"triggers": [ { "type": "manual", "enabled": true } ],
			"notes": "Created by unit tests"
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.event && data.event.id, "expected event in response" );
		this.event_id = data.event.id;
	},
	
	async function test_create_secret_for_job(test) {
		// create a new secret with fields and assignments
		const fields = [
			{ name: 'DB_HOST', value: 'db.dev.internal' },
			{ name: 'DB_USER', value: 'appuser' },
			{ name: 'DB_PASS', value: 'CorrectHorseBatteryStaple' }
		];
		let { data } = await this.request.json( this.api_url + '/app/create_secret/v1', {
			title: 'Unit Test Secret',
			enabled: true,
			icon: '',
			notes: 'Created by unit tests',
			plugins: [],
			categories: [],
			events: [ this.event_id ],
			web_hooks: [],
			fields
		});
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( data.secret && data.secret.id, 'expected secret in response' );
		assert.ok( Array.isArray(data.secret.names) && data.secret.names.length === 3, 'expected names array derived from fields' );
		assert.ok( data.secret.names.includes('DB_PASS'), 'expected DB_PASS in names' );
		this.secret_id = data.secret.id;
	},

	async function test_create_tag_for_job(test) {
		// create a final tag for use by jobs
		let { data } = await this.request.json( this.api_url + '/app/create_tag/v1', {
			title: 'Job Test Tag',
			icon: 'tag',
			notes: 'Keep me for job tests'
		});
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( data.tag && data.tag.id, 'expected tag in response' );
		this.tag_id = data.tag.id;
	},
	
	async function test_run_job_basic(test) {
		// Run a simulated two-second job, leaving time to exercise the live log API.
		let { data } = await this.request.json( this.api_url + '/app/run_event/v1', {
			id: this.event_id,
			params: { duration: 2 },
			tags: [ this.tag_id ]
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.id, "expected id in response" );
		this.job_id = data.id;
		
		// Once xySat owns a standard job, its full status updates become the source
		// of truth.  The conductor must reject local mutations that would be lost.
		await waitForRemoteJob( this, this.job_id );
		let { data:update_data } = await this.request.json( this.api_url + '/app/update_active_job/v1', {
			id: this.job_id,
			title: 'This Update Must Be Rejected'
		});
		assert.ok( update_data.code !== 0, "remote active job update was rejected" );
		assert.match( update_data.description, /running remotely/i, "remote update returned a useful error" );
		
		// Query string parameters arrive as strings.  This exact request used to
		// pass "32768" to Buffer.alloc() and crash the entire server process.
		var tail_url = this.api_url + '/app/tail_live_job_log/v1?id=' + this.job_id;
		let { data: tail_raw } = await this.request.get( tail_url + '&bytes=32768' );
		var tail_data = JSON.parse( tail_raw.toString() );
		assert.ok( tail_data.code === 0, "string byte count is safely coerced" );
		
		// Invalid and excessive allocations should return normal API errors while
		// leaving the server alive for the remaining tests.
		let { data: invalid_raw } = await this.request.get( tail_url + '&bytes=32KB' );
		var invalid_data = JSON.parse( invalid_raw.toString() );
		assert.ok( invalid_data.code !== 0, "malformed byte count is rejected" );
		
		let { data: oversized_raw } = await this.request.get( tail_url + '&bytes=1048577' );
		var oversized_data = JSON.parse( oversized_raw.toString() );
		assert.ok( oversized_data.code !== 0, "oversized byte count is rejected" );
		
		// wait for job to complete
		await waitForJob( this, this.job_id );
	},
	
	async function test_get_job_basic(test) {
		// get completed job info
		let { data } = await this.request.json( this.api_url + '/app/get_job', {
			id: this.job_id
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.job, "expected job in response" );
		
		let job = data.job;
		assert.ok( job.code == 0, "job was successful" );
		assert.ok( job.category == this.category_id, "job has correct category" );
		
		// actions
		assert.ok( !!job.actions, "job has actions array" );
		let actions = job.actions;
		assert.ok( !!Tools.findObject(actions, { type: 'email', code: 0 }), "job has successful email action" );
		assert.ok( !!Tools.findObject(actions, { type: 'web_hook', code: 0 }), "job has successful web hook action" );
		
		// tags
		assert.ok( !!job.tags, "job has tags array" );
		assert.ok( job.tags.includes(this.tag_id), "job tags has our tag" );
		
		// data + secrets
		assert.ok( !!job.data, "job has data object" );
		assert.ok( !!job.data.secrets, "job data has echoed secrets object" );
		assert.ok( job.data.secrets.DB_PASS == "CorrectHorseBatteryStaple", "correct secret in job data" );
	},

	async function test_resume_suspended_job_with_api_data(test) {
		// Create an isolated event with a start-time suspend action.  Suspend actions
		// run on the conductor, so the mock satellite does not need to execute a
		// process in order for this lifecycle to be exercised end-to-end.
		let { data:create_data } = await this.request.json( this.api_url + '/app/create_event/v1', {
			title: "Job Resume API Test Event",
			enabled: true,
			category: "general",
			targets: ["main"],
			algo: "random",
			plugin: "shellplug",
			params: { script: "#!/bin/bash\necho hello\n", duration: 1, annotate: false, json: false },
			limits: [],
			actions: [{
				enabled: true,
				condition: "start",
				type: "suspend",
				users: [],
				email: "",
				web_hook: "",
				text: ""
			}],
			triggers: [{ type: "manual", enabled: true }],
			notes: "Created by job resume API unit test"
		});
		assert.ok( create_data.code === 0, "successful event creation" );
		assert.ok( create_data.event && create_data.event.id, "expected event in response" );
		let event_id = create_data.event.id;
		
		// Launch the first simulated job and wait for the conductor-side start
		// action to suspend it before the mock satellite takes ownership.
		let { data:start_data } = await this.request.json( this.api_url + '/app/run_event/v1', {
			id: event_id,
			input: {
				data: {
					preserved: "original-input",
					replaced: "before-resume"
				}
			}
		});
		assert.ok( start_data.code === 0, "successful start-suspended job launch" );
		assert.ok( start_data.id, "expected start-suspended job id" );
		let start_job_id = start_data.id;
		let start_job = await waitForSuspendedJob( this, start_job_id, { complete: false } );
		assert.ok( !start_job.remote, "start-suspended job has not reached the satellite" );
		
		// Output injection belongs to completion-time resumes.  A rejected request
		// must leave the job suspended so the caller can correct and retry it.
		let { data:wrong_start_data } = await this.request.json( this.api_url + '/app/resume_job/v1', {
			id: start_job_id,
			data: { wrong_phase: true }
		});
		assert.ok( wrong_start_data.code !== 0, "start-time output injection was rejected" );
		await waitForSuspendedJob( this, start_job_id, { complete: false } );
		
		// Resume with both supported start-time injection types.  The input merge
		// intentionally includes a collision to verify that injected values win.
		let { data:start_resume_data } = await this.request.json( this.api_url + '/app/resume_job/v1', {
			id: start_job_id,
			params: {
				injected_param: "start-resume-value"
			},
			input: {
				data: {
					injected: "start-input-value",
					replaced: "after-resume"
				}
			}
		});
		assert.ok( start_resume_data.code === 0, "start-suspended job resumed successfully" );
		await waitForJob( this, start_job_id );
		
		let { data:start_final_data } = await this.request.json( this.api_url + '/app/get_job/v1', { id: start_job_id } );
		assert.ok( start_final_data.code === 0 && start_final_data.job, "expected completed start-suspended job" );
		let start_final_job = start_final_data.job;
		assert.equal( start_final_job.params.injected_param, "start-resume-value", "resume parameters reached the final job" );
		assert.equal( start_final_job.input.data.preserved, "original-input", "original input data was preserved" );
		assert.equal( start_final_job.input.data.injected, "start-input-value", "resume input data reached the final job" );
		assert.equal( start_final_job.input.data.replaced, "after-resume", "resume input data won the shallow-merge collision" );
		
		let start_suspend_action = Tools.findObject( start_final_job.actions, { type: 'suspend', code: 0 } );
		assert.ok( start_suspend_action, "start suspend action completed successfully" );
		assert.match( start_suspend_action.details, /### User Parameters/, "action details include injected parameters" );
		assert.match( start_suspend_action.details, /### User Input Data/, "action details include injected input data" );
		assert.match( start_suspend_action.details, /start-input-value/, "action details include the injected input value" );
		
		// Move the dedicated event's suspend action to completion time, then launch
		// a second simulated job to exercise output-data injection.
		let { data:update_data } = await this.request.json( this.api_url + '/app/update_event/v1', {
			id: event_id,
			actions: [{
				enabled: true,
				condition: "complete",
				type: "suspend",
				users: [],
				email: "",
				web_hook: "",
				text: ""
			}]
		});
		assert.ok( update_data.code === 0, "event updated for completion-time suspension" );
		
		let { data:complete_data } = await this.request.json( this.api_url + '/app/run_event/v1', { id: event_id } );
		assert.ok( complete_data.code === 0, "successful completion-suspended job launch" );
		assert.ok( complete_data.id, "expected completion-suspended job id" );
		let complete_job_id = complete_data.id;
		let complete_job = await waitForSuspendedJob( this, complete_job_id, { complete: true } );
		assert.ok( complete_job.state === 'complete', "job reached completion before suspension" );
		
		// Input injection belongs to start-time resumes and must not accidentally
		// resume a completed job when the caller sends it at the wrong phase.
		let { data:wrong_complete_data } = await this.request.json( this.api_url + '/app/resume_job/v1', {
			id: complete_job_id,
			input: { data: { wrong_phase: true } }
		});
		assert.ok( wrong_complete_data.code !== 0, "completion-time input injection was rejected" );
		await waitForSuspendedJob( this, complete_job_id, { complete: true } );
		
		// The mock satellite always emits num=42 and several other output fields.
		// Override num and add a new field to verify a true shallow merge.
		let { data:complete_resume_data } = await this.request.json( this.api_url + '/app/resume_job/v1', {
			id: complete_job_id,
			data: {
				num: 99,
				injected: "completion-output-value"
			}
		});
		assert.ok( complete_resume_data.code === 0, "completion-suspended job resumed successfully" );
		await waitForJob( this, complete_job_id );
		
		let { data:complete_final_data } = await this.request.json( this.api_url + '/app/get_job/v1', { id: complete_job_id } );
		assert.ok( complete_final_data.code === 0 && complete_final_data.job, "expected completed completion-suspended job" );
		let complete_final_job = complete_final_data.job;
		assert.equal( complete_final_job.data.num, 99, "resume output won the shallow-merge collision" );
		assert.equal( complete_final_job.data.injected, "completion-output-value", "resume output reached the final job" );
		assert.equal( complete_final_job.data.str, "foo", "original mock satellite output was preserved" );
		
		let complete_suspend_action = Tools.findObject( complete_final_job.actions, { type: 'suspend', code: 0 } );
		assert.ok( complete_suspend_action, "completion suspend action completed successfully" );
		assert.match( complete_suspend_action.details, /### User Output Data/, "action details include injected output data" );
		assert.match( complete_suspend_action.details, /completion-output-value/, "action details include the injected output value" );
	},
	
	async function test_create_simple_event_for_job(test) {
		// create simple event with no actions
		const category_id = this.category_final_id || 'general';
		let { data } = await this.request.json( this.api_url + '/app/create_event/v1', {
			"title": "Simple Test Event",
			"enabled": true,
			"category": 'general',
			"targets": ["main"],
			"algo": "random",
			"plugin": "shellplug",
			"params": { "script": "#!/bin/bash\necho hello\n", "annotate": false, "json": false },
			"limits": [  ],
			"actions": [  ],
			"triggers": [ { "type": "manual", "enabled": true } ],
			"notes": "Created by unit tests"
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.event && data.event.id, "expected event in response" );
		this.simple_event_id = data.event.id;
	},
	
	async function test_run_jobs_many(test) {
		// run many jobs in parallel
		const self = this;
		const job_ids = [];
		const MAX_JOBS = 10;
		
		// create runner function
		const run_job = async function() {
			let { data } = await self.request.json( self.api_url + '/app/run_event/v1', {
				id: self.simple_event_id,
				params: { duration: 1 }
			});
			assert.ok( data.code === 0, "successful api response" );
			assert.ok( data.id, "expected id in response" );
			job_ids.push(data.id);
			
			// wait for job to complete
			await waitForJob( self, data.id );
		}; // run_job
		
		// run run_job 10 times in parallel, await all
		const runners = [];
		for (let i = 0; i < MAX_JOBS; i++) {
			runners.push(run_job());
		}
		
		// wait for all of them to finish
		await Promise.all(runners);
		
		// ensure all ids are unique
		assert.ok( job_ids.length == MAX_JOBS, "correct number of job ids" );
		assert.ok( new Set(job_ids).size === job_ids.length, "all job ids are unique" );
		
		// fetch all of them at once
		let { data } = await this.request.json( this.api_url + '/app/get_jobs', {
			ids: job_ids
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.jobs, "expected jobs in response" );
		assert.ok( data.jobs.length == MAX_JOBS, "correct number of jobs in response" );
		assert.ok( Tools.findObjects(data.jobs, { complete: true, code: 0 }).length == MAX_JOBS, "all jobs are complete and successful" );
		
		job_ids.forEach( function(job_id, idx) {
			assert.ok( !!Tools.findObject(data.jobs, { id: job_id }), "found job idx " + idx );
		} );
		
		// Save one general-category job for the positional authorization test.
		this.simple_job_id = job_ids[0];
	},
	
	async function test_get_jobs_preserves_forbidden_positions(test) {
		// A category-limited caller should receive one response position for
		// every requested ID, with forbidden jobs represented like missing jobs.
		let created = await this.request.json( this.api_url + '/app/create_api_key/v1', {
			title: 'Unit Test Restricted Job API Key',
			description: 'Created by job unit tests',
			active: 1,
			privileges: {},
			categories: [this.category_id]
		});
		assert.ok( created.data.code === 0, "successful restricted api key creation" );
		
		var key_id = created.data.api_key.id;
		var key_opts = {
			headers: { 'X-Session-ID': '', 'X-API-Key': created.data.plain_key }
		};
		
		try {
			let { data } = await this.request.json( this.api_url + '/app/get_jobs/v1', {
				ids: [this.job_id, this.simple_job_id, this.job_id]
			}, key_opts );
			assert.ok( data.code === 0, "restricted multi-job request succeeds" );
			assert.ok( data.jobs.length === 3, "job response positions are preserved" );
			assert.ok( data.jobs[0].id === this.job_id, "first allowed job retains its position" );
			assert.ok( data.jobs[1].err && !data.jobs[1].id, "forbidden job uses a not-found placeholder" );
			assert.ok( data.jobs[2].id === this.job_id, "duplicate allowed job retains its position" );
		}
		finally {
			await this.request.json( this.api_url + '/app/delete_api_key/v1', { id: key_id } );
			delete this.simple_job_id;
		}
	},
	
	async function test_update_simple_event_queue(test) {
		// update simple event to only allow 1 job at a time + queue
		const category_id = this.category_final_id || 'general';
		let { data } = await this.request.json( this.api_url + '/app/update_event/v1', {
			"id": this.simple_event_id,
			"limits": [
				{
					"type": "job",
					"enabled": true,
					"amount": 1
				},
				{
					"type": "queue",
					"enabled": true,
					"amount": 10
				}
			]
		});
		assert.ok( data.code === 0, "successful api response" );
	},
	
	async function test_run_jobs_queue(test) {
		// run many jobs using queue
		const self = this;
		const job_ids = [];
		const MAX_JOBS = 3;
		
		// create runner function
		const run_job = async function() {
			let { data } = await self.request.json( self.api_url + '/app/run_event/v1', {
				id: self.simple_event_id,
				params: { duration: 1 }
			});
			assert.ok( data.code === 0, "successful api response" );
			assert.ok( data.id, "expected id in response" );
			job_ids.push(data.id);
		}; // run_job
		
		// run run_job 10 times in parallel, await all
		const runners = [];
		for (let i = 0; i < MAX_JOBS; i++) {
			runners.push(run_job());
		}
		await Promise.all(runners);
		
		// jobs should all be queued now, with only 1 running at a time
		await waitForAllJobs( this, {
			max_active_jobs: 1
		} );
		
		// ensure all ids are unique
		assert.ok( job_ids.length == MAX_JOBS, "correct number of job ids" );
		assert.ok( new Set(job_ids).size === job_ids.length, "all job ids are unique" );
		
		// fetch all of them at once
		let { data } = await this.request.json( this.api_url + '/app/get_jobs', {
			ids: job_ids
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.jobs, "expected jobs in response" );
		assert.ok( data.jobs.length == MAX_JOBS, "correct number of jobs in response" );
		assert.ok( Tools.findObjects(data.jobs, { complete: true, code: 0 }).length == MAX_JOBS, "all jobs are complete and successful" );
		
		job_ids.forEach( function(job_id, idx) {
			assert.ok( !!Tools.findObject(data.jobs, { id: job_id }), "found job idx " + idx );
		} );
	},
	
	async function test_update_simple_event_limit(test) {
		// update simple event to hit limit after N seconds
		const category_id = this.category_final_id || 'general';
		let { data } = await this.request.json( this.api_url + '/app/update_event/v1', {
			"id": this.simple_event_id,
			"limits": [
				{
					"type": "time",
					"enabled": true,
					"tags": [],
					"users": [],
					"email": "",
					"web_hook": this.web_hook_id,
					"text": "",
					"snapshot": false,
					"abort": false,
					"duration": 1
				}
			]
		});
		assert.ok( data.code === 0, "successful api response" );
	},
	
	async function test_run_job_limit_timeout(test) {
		// run job that will hit a max time limit and abort
		let { data } = await this.request.json( this.api_url + '/app/run_event/v1', {
			id: this.simple_event_id,
			params: { duration: 5 }
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.id, "expected id in response" );
		let job_id = data.id;
		
		// wait for job to complete
		await waitForJob( this, job_id );
		
		// fetch job details
		let { data:jdata } = await this.request.json( this.api_url + '/app/get_job', { id: job_id });
		assert.ok( jdata.code === 0, "successful api response" );
		assert.ok( jdata.job, "expected job in response" );
		
		let job = jdata.job;
		assert.ok( job.code == 0, "job was successful" );
		
		assert.ok( !!job.limits, "found limits array in job" );
		assert.ok( !!job.limits.length == 1, "correct number of limits in job" );
		let limit = job.limits[0];
		
		assert.ok( limit.type == 'time', "expected time limit" );
		assert.ok( limit.code == 0, "expected limit code to be 0" );
	},
	
];
