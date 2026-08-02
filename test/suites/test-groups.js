const assert = require('node:assert/strict');
const Tools = require('pixl-tools');

exports.tests = [

	async function test_api_get_groups(test) {
		// list all groups
		let { data } = await this.request.json( this.api_url + '/app/get_groups/v1', {} );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( Array.isArray(data.rows), "expected rows array" );
		assert.ok( data.list && (data.list.length >= 0), "expected list metadata" );
	},
	
	async function test_group_limited_resource_helpers(test) {
		// group restrictions use any-match semantics, so one shared group grants
		// access even when the resource also belongs to other groups
		var cuser = {
			privileges: {},
			categories: [],
			groups: ['allowed']
		};
		
		var events = [
			{ id: 'workflow', type: 'workflow', category: 'general', targets: [] },
			{ id: 'empty', type: 'normal', category: 'general', targets: [] },
			{ id: 'servers_only', type: 'normal', category: 'general', targets: ['server123'] },
			{ id: 'shared', type: 'normal', category: 'general', targets: ['allowed', 'forbidden', 'server123'] },
			{ id: 'forbidden', type: 'normal', category: 'general', targets: ['forbidden', 'server123'] }
		];
		var event_ids = this.xy.getUserLimitedEvents(cuser, events).map( event => event.id );
		assert.deepEqual( event_ids, ['workflow', 'shared'], "event filtering uses any-match and explicitly allows workflows" );
		
		var jobs = [
			{ id: 'workflow', type: 'workflow', category: 'general', targets: [] },
			{ id: 'empty', type: 'normal', category: 'general', targets: [] },
			{ id: 'shared', type: 'normal', category: 'general', targets: ['allowed', 'forbidden'] },
			{ id: 'forbidden', type: 'normal', category: 'general', targets: ['forbidden'] }
		];
		var job_ids = this.xy.getUserLimitedJobs(cuser, jobs).map( job => job.id );
		assert.deepEqual( job_ids, ['workflow', 'shared'], "job filtering uses any-match and explicitly allows workflows" );
		
		// Empty group lists on concrete resources are not the workflow special case,
		// so they remain outside every group-limited user's scope.
		var servers = [
			{ id: 'empty', groups: [] },
			{ id: 'shared', groups: ['allowed', 'forbidden'] },
			{ id: 'forbidden', groups: ['forbidden'] }
		];
		var server_ids = this.xy.getUserLimitedServers(cuser, servers).map( server => server.id );
		assert.deepEqual( server_ids, ['shared'], "server filtering uses any-match and rejects empty groups" );
		
		var alerts = [
			{ id: 'empty', groups: [] },
			{ id: 'shared', groups: ['allowed', 'forbidden'] },
			{ id: 'forbidden', groups: ['forbidden'] }
		];
		var alert_ids = this.xy.getUserLimitedAlerts(cuser, alerts).map( alert => alert.id );
		assert.deepEqual( alert_ids, ['shared'], "alert filtering uses any-match and rejects empty groups" );
		
		var user = { privileges: {}, roles: [], groups: ['allowed'] };
		assert.ok( !this.xy.checkTargetPrivilege(user, ['server123']), "individual server targets alone deny access" );
		assert.ok( !this.xy.checkTargetPrivilege(user, ['forbidden', 'server123']), "disallowed groups and servers deny access" );
		assert.ok( this.xy.checkTargetPrivilege(user, ['allowed', 'forbidden', 'server123']), "one matching group grants access regardless of other targets" );
		assert.ok( this.xy.checkTargetPrivilege(user, []), "empty workflow targets retain their existing access behavior" );
		
		// Empty target arrays are only valid for workflows.  This preserves the
		// invariant used by checkTargetPrivilege() to recognize workflow targets.
		var validation_error = null;
		var valid = this.xy.requireValidEventData({ type: 'normal', targets: [] }, function(data) { validation_error = data; });
		assert.ok( !valid && validation_error, "ordinary events cannot have empty target arrays" );
		assert.ok( this.xy.requireValidEventData({
			type: 'workflow',
			targets: [],
			workflow: { nodes: [], connections: [] }
		}, function() {}), "workflows retain empty target arrays" );
	},
	
	async function test_recursive_workflow_privilege_helper(test) {
		// Workflow reads use only the top-level category, but create, update and
		// manual run operations must validate every reachable nested node.
		var user = { privileges: {}, roles: [], categories: ['allowed_cat'], groups: ['allowed_group'] };
		var eventNode = function(id, targets) {
			return { type: 'event', data: { event: id, targets: targets || [] } };
		};
		var workflow = function(id, nodes) {
			return { id: id, type: 'workflow', category: 'allowed_cat', targets: [], workflow: { nodes: nodes } };
		};
		var original_events = this.xy.events;
		this.xy.events = original_events.concat([
			{ id: 'allowed_event', type: 'normal', category: 'allowed_cat', targets: ['allowed_group'] },
			workflow('nested_workflow', [eventNode('allowed_event'), eventNode('cyclic_workflow')]),
			workflow('cyclic_workflow', [eventNode('nested_workflow')]),
			workflow('forbidden_workflow', [
				{ type: 'job', data: { category: 'forbidden_cat', targets: ['allowed_group'] } }
			])
		]);
		
		try {
			var allowed = this.xy.requireWorkflowPrivileges(user, {
				nodes: [eventNode('nested_workflow')]
			}, function() {});
			assert.ok( allowed, "recursive allowed workflow passes, including a safe cycle" );
			
			var error = null;
			var denied = this.xy.requireWorkflowPrivileges(user, {
				nodes: [eventNode('allowed_event', ['forbidden_group'])]
			}, function(data) { error = data; });
			assert.ok( !denied && error, "forbidden Event Node target override is rejected" );
			
			error = null;
			denied = this.xy.requireWorkflowPrivileges(user, {
				nodes: [eventNode('forbidden_workflow')]
			}, function(data) { error = data; });
			assert.ok( !denied && error, "forbidden Job Node category in a nested workflow is rejected" );
		}
		finally {
			this.xy.events = original_events;
		}
	},

	async function test_api_get_group_missing_param(test) {
		// missing id param
		let { data } = await this.request.json( this.api_url + '/app/get_group/v1', {} );
		assert.ok( !!data.code, "expected error for missing id" );
	},

	async function test_api_get_group_missing(test) {
		// non-existent group
		let { data } = await this.request.json( this.api_url + '/app/get_group/v1', { id: 'nope' } );
		assert.ok( !!data.code, "expected error for missing group" );
	},

	async function test_api_create_group_missing_title(test) {
		// missing required title
		let { data } = await this.request.json( this.api_url + '/app/create_group/v1', {
			"hostname_match": ".+"
		});
		assert.ok( !!data.code, "expected error for missing title" );
	},

	async function test_api_create_group_missing_hostname(test) {
		// missing required hostname_match
		let { data } = await this.request.json( this.api_url + '/app/create_group/v1', {
			"title": "Unit Test Group"
		});
		assert.ok( !!data.code, "expected error for missing hostname_match" );
	},

	async function test_api_create_group_invalid_action(test) {
		// invalid alert action (invalid condition)
		let { data } = await this.request.json( this.api_url + '/app/create_group/v1', {
			"title": "Bad Group",
			"hostname_match": ".+",
			"alert_actions": [ { "enabled": true, "condition": "nope", "type": "email", "users": ["admin"] } ]
		});
		assert.ok( !!data.code, "expected error for invalid alert action" );
	},

	async function test_api_create_group(test) {
		// create new group
		let { data } = await this.request.json( this.api_url + '/app/create_group/v1', {
			"title": "Unit Test Group",
			"hostname_match": ".+",
			"notes": "Created by unit tests"
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.group && data.group.id, "expected group in response" );
		this.group_id = data.group.id;
	},

	async function test_api_get_new_group(test) {
		// fetch our group
		let { data } = await this.request.json( this.api_url + '/app/get_group/v1', { id: this.group_id } );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.group && data.group.id === this.group_id, "group id unexpected" );
		assert.ok( data.group.title === 'Unit Test Group', "unexpected group title" );
		assert.ok( !!data.group.hostname_match, "expected hostname_match" );
	},

	async function test_api_update_group_missing_id(test) {
		// update without id should error
		let { data } = await this.request.json( this.api_url + '/app/update_group/v1', { title: 'oops' } );
		assert.ok( !!data.code, "expected error for missing id" );
	},

	async function test_api_update_group(test) {
		// update our group
		let { data } = await this.request.json( this.api_url + '/app/update_group/v1', {
			id: this.group_id,
			title: 'UTG v2',
			hostname_match: '^satunit'
		});
		assert.ok( data.code === 0, "successful api response" );
	},

	async function test_api_update_group_invalid_action(test) {
		// invalid alert action on update (missing users/email)
		let { data } = await this.request.json( this.api_url + '/app/update_group/v1', {
			id: this.group_id,
			alert_actions: [ { enabled: true, condition: 'error', type: 'email' } ]
		});
		assert.ok( !!data.code, "expected error for invalid alert action on update" );
	},

	async function test_api_get_updated_group(test) {
		// verify updates
		let { data } = await this.request.json( this.api_url + '/app/get_group/v1', { id: this.group_id } );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.group && data.group.title === 'UTG v2', "unexpected group title" );
		assert.ok( data.group.hostname_match === '^satunit', "unexpected hostname_match" );
	},

	async function test_api_delete_group_missing_id(test) {
		// delete without id should error
		let { data } = await this.request.json( this.api_url + '/app/delete_group/v1', {} );
		assert.ok( !!data.code, "expected error for missing id" );
	},

	async function test_api_delete_group_nonexistent(test) {
		// delete non-existent group should error
		let { data } = await this.request.json( this.api_url + '/app/delete_group/v1', { id: 'nope' } );
		assert.ok( !!data.code, "expected error for missing group" );
	},

	async function test_api_delete_group(test) {
		// delete our group
		let { data } = await this.request.json( this.api_url + '/app/delete_group/v1', { id: this.group_id } );
		assert.ok( data.code === 0, "successful api response" );
	},

	async function test_api_get_group_deleted(test) {
		// ensure deleted
		let { data } = await this.request.json( this.api_url + '/app/get_group/v1', { id: this.group_id } );
		assert.ok( !!data.code, "expected error for missing group" );
		delete this.group_id;
	},

	async function test_api_stub_multi_update_group(test) {
		// stubbed: skip multi_update_group
		assert.ok(true, 'stub multi_update_group');
	},

	async function test_api_stub_watch_group(test) {
		// stubbed: skip watch_group
		assert.ok(true, 'stub watch_group');
	},

	async function test_api_create_group_final(test) {
		// create a final group for other suites
		let { data } = await this.request.json( this.api_url + '/app/create_group/v1', {
			"title": "Unit Test Group Final",
			"hostname_match": ".+",
			"notes": "Keep me for future tests"
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.group && data.group.id, "expected group in response" );
		this.group_final_id = data.group.id;
	},

	async function test_api_create_group_snapshot(test) {
		// create a snapshot for the final group and save the id
		let { data } = await this.request.json( this.api_url + '/app/create_group_snapshot/v1', {
			group: this.group_final_id
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.id, "expected snapshot id in response" );
		this.group_snapshot_id = data.id;
	}

];
