const assert = require('node:assert/strict');
const PixlRequest = require('pixl-request');

exports.tests = [
	
	async function test_get_user_activity(test) {
		// get user activity log
		let { data } = await this.request.json( this.api_url + '/app/get_user_activity', {
			offset: 0,
			limit: 50
		} );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( !!data.rows && Array.isArray(data.rows), "expected rows to be array" );
		assert.ok( data.rows.length > 0, "expected at least one row" );
	},
	
	async function test_user_settings(test) {
		// change some user settings
		let { data } = await this.request.json( this.api_url + '/app/user_settings', {
			"language": "en-US",
			"timezone": "America/Los_Angeles",
			"contrast": "high",
			"motion": "reduced"
		} );
		assert.ok( data.code === 0, "successful user settings update" );
		
		// fetch user using admin api to see our changes
		let resp = await this.request.json( this.api_url + '/user/admin_get_user', {
			"username": "testuser"
		} );
		assert.ok( resp.data.code === 0, "successful admin_get_user" );
		assert.ok( !!resp.data.user, "expected user object in response" );
		assert.ok( resp.data.user.contrast == "high", "expected high contrast in user object in response" );
	},
	
	async function test_user_settings_cannot_change_resource_limits(test) {
		// create a directly limited non-administrator account so we can exercise
		// the self-service settings endpoint as the restricted user
		let { data:create_data } = await this.request.json( this.api_url + '/user/admin_create', {
			username: 'ut_limited_settings',
			password: 'ut_limited_settings',
			full_name: 'Unit Test Limited Settings',
			email: 'ut-limited-settings@localhost',
			active: 1,
			privileges: {},
			roles: [],
			categories: ['general'],
			groups: ['main']
		} );
		assert.ok( create_data.code === 0, "successful limited user creation" );
		
		// use an isolated request object so the suite's administrator session is
		// preserved for verification and cleanup
		var limited_request = new PixlRequest( "xyOps Limited User Tester" );
		limited_request.setTimeout( 30 * 1000 );
		limited_request.setFollow( 5 );
		limited_request.setAutoError( false );
		limited_request.setKeepAlive( true );
		
		let { resp:login_resp, data:login_data } = await limited_request.json( this.api_url + '/user/login', {
			username: 'ut_limited_settings',
			password: 'ut_limited_settings'
		} );
		assert.ok( login_data.code === 0, "successful limited user login" );
		assert.ok( login_resp.headers['set-cookie'] && login_resp.headers['set-cookie'][0], "expected limited user session cookie" );
		
		var matches = login_resp.headers['set-cookie'][0].match(/session_id=(\w+)/);
		assert.ok( matches && matches[1], "expected limited user session id" );
		limited_request.setHeader( 'X-Session-ID', matches[1] );
		
		// attempt the original bypass while also changing an ordinary preference;
		// the preference should save, while both protected arrays remain unchanged
		let { data:settings_data } = await limited_request.json( this.api_url + '/app/user_settings', {
			contrast: 'low',
			categories: [],
			groups: []
		} );
		assert.ok( settings_data.code === 0, "successful limited user settings update" );
		assert.ok( settings_data.user.contrast === 'low', "ordinary user setting was updated" );
		assert.deepEqual( settings_data.user.categories, ['general'], "category restrictions cannot be changed through user settings" );
		assert.deepEqual( settings_data.user.groups, ['main'], "group restrictions cannot be changed through user settings" );
		
		// fetch the record through the administrator API to verify the restrictions
		// were preserved in storage, not merely restored in the response
		let { data:user_data } = await this.request.json( this.api_url + '/user/admin_get_user', {
			username: 'ut_limited_settings'
		} );
		assert.ok( user_data.code === 0, "successful limited user fetch" );
		assert.deepEqual( user_data.user.categories, ['general'], "stored category restrictions were preserved" );
		assert.deepEqual( user_data.user.groups, ['main'], "stored group restrictions were preserved" );
		
		let { data:delete_data } = await this.request.json( this.api_url + '/user/admin_delete', {
			username: 'ut_limited_settings'
		} );
		assert.ok( delete_data.code === 0, "successful limited user fixture deletion" );
	},
	
	async function test_admin_users_have_no_resource_limits(test) {
		// create a role which grants administrator, but also contains resource
		// limits, so we can confirm the admin privilege always wins
		let { data:role_data } = await this.request.json( this.api_url + '/app/create_role/v1', {
			title: 'Unit Test Administrator Role',
			enabled: true,
			categories: ['general'],
			groups: ['main'],
			privileges: { admin: true }
		} );
		assert.ok( role_data.code === 0, "successful administrator role creation" );
		assert.ok( role_data.role && role_data.role.id, "expected administrator role id" );
		this.admin_scope_role_id = role_data.role.id;
		
		// exercise the computed helpers directly with deliberately stale limits
		// on both a direct administrator and a role-inherited administrator
		var direct_admin = {
			privileges: { admin: true },
			roles: [],
			categories: ['general'],
			groups: ['main']
		};
		assert.deepEqual( this.xy.getComputedCategories(direct_admin), [], "direct administrator has no computed category limits" );
		assert.deepEqual( this.xy.getComputedGroups(direct_admin), [], "direct administrator has no computed group limits" );
		
		var role_admin = {
			privileges: {},
			roles: [this.admin_scope_role_id],
			categories: ['general'],
			groups: ['main']
		};
		assert.deepEqual( this.xy.getComputedCategories(role_admin), [], "role administrator has no computed category limits" );
		assert.deepEqual( this.xy.getComputedGroups(role_admin), [], "role administrator has no computed group limits" );
		
		// create an inherited administrator with explicit limits and confirm the
		// before-create hook removes the limits from the persisted user record
		let { data:create_data } = await this.request.json( this.api_url + '/user/admin_create', {
			username: 'ut_admin_scope',
			password: 'ut_admin_scope',
			full_name: 'Unit Test Scoped Administrator',
			email: 'ut-admin-scope@localhost',
			active: 1,
			privileges: {},
			roles: [this.admin_scope_role_id],
			categories: ['general'],
			groups: ['main']
		} );
		assert.ok( create_data.code === 0, "successful inherited administrator creation" );
		
		let created = await this.request.json( this.api_url + '/user/admin_get_user', {
			username: 'ut_admin_scope'
		} );
		assert.ok( created.data.code === 0, "successful inherited administrator fetch" );
		assert.deepEqual( created.data.user.categories, [], "created administrator category limits were removed" );
		assert.deepEqual( created.data.user.groups, [], "created administrator group limits were removed" );
		
		// demote the fixture and restore limits, then promote it through the role.
		// This confirms the before-update hook evaluates the final merged user.
		let { data:demote_data } = await this.request.json( this.api_url + '/user/admin_update', {
			username: 'ut_admin_scope',
			privileges: {},
			roles: [],
			categories: ['general'],
			groups: ['main']
		} );
		assert.ok( demote_data.code === 0, "successful administrator demotion" );
		assert.deepEqual( demote_data.user.categories, ['general'], "non-administrator category limits were retained" );
		assert.deepEqual( demote_data.user.groups, ['main'], "non-administrator group limits were retained" );
		
		let { data:role_promote_data } = await this.request.json( this.api_url + '/user/admin_update', {
			username: 'ut_admin_scope',
			roles: [this.admin_scope_role_id]
		} );
		assert.ok( role_promote_data.code === 0, "successful role administrator promotion" );
		assert.deepEqual( role_promote_data.user.categories, [], "role promotion removed category limits" );
		assert.deepEqual( role_promote_data.user.groups, [], "role promotion removed group limits" );
		
		// Finally, switch to direct administrator while attempting to restore
		// limits, and confirm the direct privilege also forces both arrays empty.
		let { data:direct_promote_data } = await this.request.json( this.api_url + '/user/admin_update', {
			username: 'ut_admin_scope',
			privileges: { admin: true },
			roles: [],
			categories: ['general'],
			groups: ['main']
		} );
		assert.ok( direct_promote_data.code === 0, "successful direct administrator promotion" );
		assert.deepEqual( direct_promote_data.user.categories, [], "direct promotion removed category limits" );
		assert.deepEqual( direct_promote_data.user.groups, [], "direct promotion removed group limits" );
	},
	
	async function test_admin_scope_cleanup(test) {
		// remove all fixtures created by the administrator scope tests
		let { data:user_data } = await this.request.json( this.api_url + '/user/admin_delete', {
			username: 'ut_admin_scope'
		} );
		assert.ok( user_data.code === 0, "successful administrator fixture deletion" );
		
		let { data:role_data } = await this.request.json( this.api_url + '/app/delete_role/v1', {
			id: this.admin_scope_role_id
		} );
		assert.ok( role_data.code === 0, "successful administrator role fixture deletion" );
		delete this.admin_scope_role_id;
	},
	
	async function test_user_logout_all(test) {
		// logout all sessions except the current one
		let { data } = await this.request.json( this.api_url + '/app/logout_all', {
			password: "testuser"
		} );
		assert.ok( data.code === 0, "successful api response" );
	}
	
];
