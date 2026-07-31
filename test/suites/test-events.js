const assert = require('node:assert/strict');
const Tools = require('pixl-tools');

// helper: sleep while waiting for an asynchronously launched job
async function sleep(ms) {
	await new Promise(res => setTimeout(res, ms));
}

// helper: poll active jobs until the specified job has completed
async function waitForJob(ctx, job_id, opts = {}) {
	const timeout = opts.timeout || 20000;
	const interval = opts.interval || 250;
	const start = performance.now();
	
	while (performance.now() - start < timeout) {
		let { data } = await ctx.request.json(ctx.api_url + '/app/get_active_jobs/v1', {});
		if (data.code !== 0) throw new Error('get_active_jobs failed');
		if (!data.rows.find(row => row.id === job_id)) return;
		await sleep(interval);
	}
	
	throw new Error('Timed out waiting for job to finish');
}

exports.tests = [

	async function test_api_get_events(test) {
		// list all events
		let { data } = await this.request.json( this.api_url + '/app/get_events/v1', {} );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( Array.isArray(data.rows), "expected rows array" );
		assert.ok( data.list && (data.list.length >= 0), "expected list metadata" );
	},

	async function test_api_get_event_missing_param(test) {
		// missing id param
		let { data } = await this.request.json( this.api_url + '/app/get_event/v1', {} );
		assert.ok( !!data.code, "expected error for missing id" );
	},

	async function test_api_create_event_missing_plugin(test) {
		// create event missing plugin should error (non-workflow)
		let { data } = await this.request.json( this.api_url + '/app/create_event/v1', {
			"title": "Bad Event",
			"enabled": true,
			"category": this.category_final_id || 'general',
			"targets": ["main"]
		});
		assert.ok( !!data.code, "expected error for missing plugin" );
	},

	async function test_api_create_event_missing_targets(test) {
		// create event missing targets should error (non-workflow)
		let { data } = await this.request.json( this.api_url + '/app/create_event/v1', {
			"title": "Bad Event 2",
			"enabled": true,
			"category": this.category_final_id || 'general',
			"plugin": "shellplug"
		});
		assert.ok( !!data.code, "expected error for missing targets" );
	},

	async function test_api_create_event_invalid_limit(test) {
		// invalid limit (duration must be number for time)
		const category_id = this.category_final_id || 'general';
		let { data } = await this.request.json( this.api_url + '/app/create_event/v1', {
			"title": "Bad Event 3",
			"enabled": true,
			"category": category_id,
			"targets": ["main"],
			"plugin": "shellplug",
			"limits": [ { enabled: true, type: 'time', duration: 'nope' } ]
		});
		assert.ok( !!data.code, "expected error for invalid limit" );
	},

	async function test_api_create_event_invalid_action(test) {
		// invalid action (email requires users array or email string)
		const category_id = this.category_final_id || 'general';
		let { data } = await this.request.json( this.api_url + '/app/create_event/v1', {
			"title": "Bad Event 4",
			"enabled": true,
			"category": category_id,
			"targets": ["main"],
			"plugin": "shellplug",
			"actions": [ { enabled: true, condition: 'error', type: 'email' } ]
		});
		assert.ok( !!data.code, "expected error for invalid action" );
	},

	async function test_api_create_event(test) {
		// create new event (non-workflow)
		const category_id = this.category_final_id || 'general';
		let { data } = await this.request.json( this.api_url + '/app/create_event/v1', {
			"title": "Unit Test Event",
			"enabled": true,
			"category": category_id,
			"targets": ["main"],
			"algo": "random",
			"plugin": "shellplug",
			"params": { "script": "#!/bin/bash\necho hello\n", "annotate": false, "json": false },
			"limits": [ { enabled: true, type: 'time', duration: 60 } ],
			"actions": [ { enabled: true, condition: 'error', type: 'email', users: ['admin'] } ],
			"triggers": [ { "type": "manual", "enabled": true } ],
			"notes": "Created by unit tests"
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.event && data.event.id, "expected event in response" );
		this.event_id = data.event.id;
	},

	async function test_api_get_new_event(test) {
		// fetch our new event
		let { data } = await this.request.json( this.api_url + '/app/get_event/v1', { id: this.event_id } );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.event && data.event.id === this.event_id, "event id unexpected" );
		assert.ok( Array.isArray(data.jobs) && typeof data.queued === 'number', "expected jobs and queued in response" );
		assert.ok( Array.isArray(data.event.limits) && data.event.limits.length === 1, "expected one limit" );
		assert.ok( data.event.limits[0].type === 'time' && data.event.limits[0].duration === 60, "unexpected limit content" );
		assert.ok( Array.isArray(data.event.actions) && data.event.actions.length === 1, "expected one action" );
		assert.ok( data.event.actions[0].type === 'email' && data.event.actions[0].enabled === true, "unexpected action content" );
	},

	async function test_api_event_rejects_reserved_job_override(test) {
		// reserved _xy_override_* params must not be allowed to alter launch context
		let event = Tools.findObject( this.xy.events, { id: this.event_id } );
		let error = null;
		let valid = this.xy.requireValidEventData(
			Tools.mergeHashes(event, { params: { _xy_override_uid: '0' } }),
			function(data) { error = data; }
		);

		assert.ok( valid === false, "reserved job override should fail validation" );
		assert.ok( error && error.code === 'api', "expected api validation error" );
		assert.ok( error.description.match(/reserved/), "expected reserved-key error" );
	},

	async function test_api_update_event_missing_id(test) {
		// update without id should error
		let { data } = await this.request.json( this.api_url + '/app/update_event/v1', { title: 'oops' } );
		assert.ok( !!data.code, "expected error for missing id" );
	},

	async function test_api_update_event(test) {
		// update our event
		let { data } = await this.request.json( this.api_url + '/app/update_event/v1', {
			id: this.event_id,
			title: 'UTE v2',
			notes: 'updated by tests'
		});
		assert.ok( data.code === 0, "successful api response" );
	},

	async function test_api_update_event_invalid_limit(test) {
		// invalid limit on update (file.amount must be number)
		let { data } = await this.request.json( this.api_url + '/app/update_event/v1', {
			id: this.event_id,
			limits: [ { enabled: true, type: 'file', amount: 'nope' } ]
		});
		assert.ok( !!data.code, "expected error for invalid limit on update" );
	},

	async function test_api_update_event_invalid_action(test) {
		// invalid action on update (invalid condition)
		let { data } = await this.request.json( this.api_url + '/app/update_event/v1', {
			id: this.event_id,
			actions: [ { enabled: true, condition: 'nope', type: 'email', users: ['admin'] } ]
		});
		assert.ok( !!data.code, "expected error for invalid action on update" );
	},

	async function test_api_update_event_locked_script_non_admin_api_key(test) {
		// create a non-admin API key that can edit events, but cannot edit locked params
		let created = await this.request.json( this.api_url + '/app/create_api_key/v1', {
			title: 'Unit Test Event Edit API Key',
			description: 'Created by event unit tests',
			active: 1,
			privileges: { edit_events: 1 }
		});
		assert.ok( created.data.code === 0, "successful api key creation" );
		assert.ok( created.data.api_key && created.data.api_key.id, "expected api key in response" );
		assert.ok( created.data.plain_key, "expected plain api key" );
		
		let api_key_id = created.data.api_key.id;
		let plain_key = created.data.plain_key;
		let original_script = "#!/bin/bash\necho hello\n";
		let hostile_script = "#!/bin/bash\necho pwned\n";
		
		try {
			// attempt to bypass the admin lock by omitting plugin and sending a new script
			let { data } = await this.request.json( this.api_url + '/app/update_event/v1', {
				id: this.event_id,
				title: 'UTE v3',
				params: {
					script: hostile_script,
					annotate: true,
					json: false
				}
			}, {
				headers: {
					'X-Session-ID': '',
					'X-API-Key': plain_key
				}
			} );
			assert.ok( data.code === 0, "successful non-admin api response" );
			assert.ok( data.event && data.event.title === 'UTE v3', "expected unlocked event title update" );
			assert.ok( data.event.params.script === original_script, "locked script should remain unchanged" );
			assert.ok( data.event.params.script !== hostile_script, "locked script should reject non-admin override" );
			assert.ok( data.event.params.annotate === true, "unlocked param should still update" );
			
			// verify the persisted event too, not just the update_event response
			let fetched = await this.request.json( this.api_url + '/app/get_event/v1', { id: this.event_id } );
			assert.ok( fetched.data.code === 0, "successful get_event response" );
			assert.ok( fetched.data.event.params.script === original_script, "persisted locked script should remain unchanged" );
			assert.ok( fetched.data.event.params.script !== hostile_script, "persisted locked script should reject non-admin override" );
			assert.ok( fetched.data.event.params.annotate === true, "persisted unlocked param should still update" );
		}
		finally {
			// clean up the temporary key even if the security assertion fails
			await this.request.json( this.api_url + '/app/delete_api_key/v1', { id: api_key_id } );
		}
	},
	
	async function test_api_get_updated_event(test) {
		// verify updates
		let { data } = await this.request.json( this.api_url + '/app/get_event/v1', { id: this.event_id } );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.event && data.event.title === 'UTE v3', "unexpected event title" );
		assert.ok( data.event.notes === 'updated by tests', "unexpected event notes" );
		assert.ok( data.event.params.script === "#!/bin/bash\necho hello\n", "locked script should remain unchanged" );
	},

	async function test_api_get_event_history(test) {
		// fetch history for our event
		let { data } = await this.request.json( this.api_url + '/app/get_event_history/v1', { id: this.event_id, limit: 50 } );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( Array.isArray(data.rows), "expected rows array" );
		assert.ok( data.list && (data.list.length >= 1), "expected at least one history record" );
	},

	async function test_api_run_workflow_preserves_locked_event_script(test) {
		// Reproduce issue #397: A workflow Event Node inherits its locked Shell
		// script from the linked Event, rather than storing it as a node override.
		const category_id = this.category_final_id || 'general';
		const trigger_node_id = 'nlockedtrigger';
		const event_node_id = 'nlockedevent';
		const original_script = "#!/bin/bash\necho hello\n";
		const hostile_script = "#!/bin/bash\necho pwned\n";
		const plugin_default_script = "#!/bin/sh\n\n# Enter your shell script code here";
		
		let created_workflow = await this.request.json( this.api_url + '/app/create_event/v1', {
			title: 'Locked Script Workflow Test',
			enabled: true,
			category: category_id,
			type: 'workflow',
			params: {},
			fields: [],
			limits: [],
			actions: [],
			triggers: [ { id: trigger_node_id, type: 'manual', enabled: true } ],
			workflow: {
				nodes: [
					{ id: trigger_node_id, type: 'trigger', x: 100, y: 100 },
					{
						id: event_node_id,
						type: 'event',
						data: {
							event: this.event_id,
							params: {},
							targets: [],
							algo: '',
							tags: []
						},
						x: 300,
						y: 100
					}
				],
				connections: [
					{ id: 'clockedscript', source: trigger_node_id, dest: event_node_id }
				]
			}
		});
		assert.ok( created_workflow.data.code === 0, "successful workflow creation" );
		assert.ok( created_workflow.data.event && created_workflow.data.event.id, "expected workflow in response" );
		
		let workflow = created_workflow.data.event;
		let workflow_id = workflow.id;
		let created_key = await this.request.json( this.api_url + '/app/create_api_key/v1', {
			title: 'Unit Test Workflow Run API Key',
			description: 'Created by event unit tests',
			active: 1,
			privileges: { run_jobs: 1 }
		});
		assert.ok( created_key.data.code === 0, "successful api key creation" );
		assert.ok( created_key.data.api_key && created_key.data.api_key.id, "expected api key in response" );
		assert.ok( created_key.data.plain_key, "expected plain api key" );
		
		let api_key_id = created_key.data.api_key.id;
		let plain_key = created_key.data.plain_key;
		
		try {
			// Match the browser's manual-run behavior by posting a full copy of the
			// workflow.  Also inject a hostile locked override to verify that the
			// server restores the original node state, which here means inheritance.
			let run_payload = Tools.copyHash(workflow, true);
			let event_node = Tools.findObject(run_payload.workflow.nodes, { id: event_node_id });
			event_node.data.params.script = hostile_script;
			
			let { data } = await this.request.json( this.api_url + '/app/run_event/v1', run_payload, {
				headers: {
					'X-Session-ID': '',
					'X-API-Key': plain_key
				}
			});
			assert.ok( data.code === 0, "successful non-admin workflow run" );
			assert.ok( data.id, "expected workflow job id in response" );
			
			// Wait for both the parent workflow and its child Event job to finish,
			// then inspect the exact params delivered to the child job.
			await waitForJob(this, data.id);
			let { data:parent_data } = await this.request.json( this.api_url + '/app/get_job', { id: data.id } );
			assert.ok( parent_data.code === 0 && parent_data.job, "expected completed workflow job" );
			assert.ok( parent_data.job.code === 0, "workflow completed successfully" );
			assert.ok( parent_data.job.workflow.jobs[event_node_id], "expected child job for Event Node" );
			assert.ok( parent_data.job.workflow.jobs[event_node_id].length === 1, "expected exactly one child job" );
			
			let child_job_id = parent_data.job.workflow.jobs[event_node_id][0].id;
			let { data:child_data } = await this.request.json( this.api_url + '/app/get_job', { id: child_job_id } );
			assert.ok( child_data.code === 0 && child_data.job, "expected completed child job" );
			assert.ok( child_data.job.params.script === original_script, "child job inherited the linked Event script" );
			assert.ok( child_data.job.params.script !== hostile_script, "locked runtime script override was rejected" );
			assert.ok( child_data.job.params.script !== plugin_default_script, "linked Event script was not replaced by Plugin default" );
		}
		finally {
			// Clean up temporary definitions even if one of the regression assertions fails.
			await this.request.json( this.api_url + '/app/delete_api_key/v1', { id: api_key_id } );
			await this.request.json( this.api_url + '/app/delete_event/v1', { id: workflow_id } );
		}
	},

	async function test_api_delete_event_missing_id(test) {
		// delete without id should error
		let { data } = await this.request.json( this.api_url + '/app/delete_event/v1', {} );
		assert.ok( !!data.code, "expected error for missing id" );
	},

	async function test_api_delete_event_nonexistent(test) {
		// delete non-existent event should error
		let { data } = await this.request.json( this.api_url + '/app/delete_event/v1', { id: 'nope' } );
		assert.ok( !!data.code, "expected error for missing event" );
	},

	async function test_api_delete_event(test) {
		// delete our event
		let { data } = await this.request.json( this.api_url + '/app/delete_event/v1', { id: this.event_id } );
		assert.ok( data.code === 0, "successful api response" );
	},

	async function test_api_get_event_deleted(test) {
		// ensure deleted
		let { data } = await this.request.json( this.api_url + '/app/get_event/v1', { id: this.event_id } );
		assert.ok( !!data.code, "expected error for missing event" );
		delete this.event_id;
	},

];
