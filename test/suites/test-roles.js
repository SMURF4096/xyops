const assert = require('node:assert/strict');
const PixlRequest = require('pixl-request');
const Tools = require('pixl-tools');

exports.tests = [

    async function test_api_get_roles(test) {
        // list all roles
        let { data } = await this.request.json( this.api_url + '/app/get_roles/v1', {} );
        assert.ok( data.code === 0, 'successful api response' );
        assert.ok( Array.isArray(data.rows), 'expected rows array' );
        assert.ok( data.list && (data.list.length >= 0), 'expected list metadata' );
        // sanity check that built-in role exists
        assert.ok( Tools.findObject(data.rows, { id: 'all' } ), 'expected role "all" to exist' );
    },

    async function test_api_get_role_missing_param(test) {
        // missing id param
        let { data } = await this.request.json( this.api_url + '/app/get_role/v1', {} );
        assert.ok( !!data.code, 'expected error for missing id' );
    },

    async function test_api_get_role_missing(test) {
        // non-existent role
        let { data } = await this.request.json( this.api_url + '/app/get_role/v1', { id: 'nope' } );
        assert.ok( !!data.code, 'expected error for missing role' );
    },

    async function test_api_create_role_missing_title(test) {
        // missing required title
        let { data } = await this.request.json( this.api_url + '/app/create_role/v1', { enabled: true } );
        assert.ok( !!data.code, 'expected error for missing title' );
    },

    async function test_api_create_role(test) {
        // create new role
        let { data } = await this.request.json( this.api_url + '/app/create_role/v1', {
            title: 'Unit Test Role',
            enabled: true,
            icon: 'account-hard-hat',
            notes: 'Created by unit tests',
            categories: ['general'],
            groups: ['main'],
            privileges: { view_jobs: true }
        });
        assert.ok( data.code === 0, 'successful api response' );
        assert.ok( data.role && data.role.id, 'expected role in response' );
        this.role_id = data.role.id;
    },

    async function test_api_get_new_role(test) {
        // fetch our role
        let { data } = await this.request.json( this.api_url + '/app/get_role/v1', { id: this.role_id } );
        assert.ok( data.code === 0, 'successful api response' );
        assert.ok( data.role && data.role.id === this.role_id, 'role id unexpected' );
        assert.ok( data.role.title === 'Unit Test Role', 'unexpected role title' );
        assert.ok( data.role.privileges && (data.role.privileges.view_jobs === true), 'unexpected role privileges' );
    },

	async function test_api_role_mutations_require_admin(test) {
		// Create a non-administrator with all three legacy role-management
		// privileges. These keys may still exist in upgraded installations, but
		// they must no longer authorize any changes to role definitions.
		let { data:create_user_data } = await this.request.json( this.api_url + '/user/admin_create', {
			username: 'ut_role_manager',
			password: 'ut_role_manager',
			full_name: 'Unit Test Role Manager',
			email: 'ut-role-manager@localhost',
			active: 1,
			privileges: {
				create_roles: true,
				edit_roles: true,
				delete_roles: true
			},
			roles: []
		} );
		assert.ok( create_user_data.code === 0, 'successful role manager fixture creation' );
		
		// Use an isolated client so the suite keeps its administrator session for
		// verification and cleanup after each rejected mutation.
		var role_manager_request = new PixlRequest( 'xyOps Role Manager Tester' );
		role_manager_request.setTimeout( 30 * 1000 );
		role_manager_request.setFollow( 5 );
		role_manager_request.setAutoError( false );
		role_manager_request.setKeepAlive( true );
		
		let { resp:login_resp, data:login_data } = await role_manager_request.json( this.api_url + '/user/login', {
			username: 'ut_role_manager',
			password: 'ut_role_manager'
		} );
		assert.ok( login_data.code === 0, 'successful role manager login' );
		assert.ok( login_resp.headers['set-cookie'] && login_resp.headers['set-cookie'][0], 'expected role manager session cookie' );
		
		var matches = login_resp.headers['set-cookie'][0].match(/session_id=(\w+)/);
		assert.ok( matches && matches[1], 'expected role manager session id' );
		role_manager_request.setHeader( 'X-Session-ID', matches[1] );
		
		// Creating an administrator role was one path to privilege escalation.
		let { data:create_role_data } = await role_manager_request.json( this.api_url + '/app/create_role/v1', {
			id: 'ut_rogue_role',
			title: 'Unit Test Rogue Role',
			enabled: true,
			privileges: { admin: true }
		} );
		assert.ok( create_role_data.code === 'access', 'non-administrator cannot create roles' );
		assert.ok( /Administrator/.test(create_role_data.description || ''), 'create error names the required Administrator privilege' );
		
		// Reproduce the reported attack against an existing role. The role must
		// remain unchanged after the rejected request.
		let { data:update_role_data } = await role_manager_request.json( this.api_url + '/app/update_role/v1', {
			id: this.role_id,
			privileges: { edit_roles: true, admin: true }
		} );
		assert.ok( update_role_data.code === 'access', 'non-administrator cannot update roles' );
		assert.ok( /Administrator/.test(update_role_data.description || ''), 'update error names the required Administrator privilege' );
		
		// Deleting a role can also alter effective privileges and resource limits,
		// so it belongs behind the same administrator boundary.
		let { data:delete_role_data } = await role_manager_request.json( this.api_url + '/app/delete_role/v1', {
			id: this.role_id
		} );
		assert.ok( delete_role_data.code === 'access', 'non-administrator cannot delete roles' );
		assert.ok( /Administrator/.test(delete_role_data.description || ''), 'delete error names the required Administrator privilege' );
		
		let { data:rogue_role_data } = await this.request.json( this.api_url + '/app/get_role/v1', {
			id: 'ut_rogue_role'
		} );
		assert.ok( rogue_role_data.code === 'notfound', 'rejected role was not created' );
		
		let { data:original_role_data } = await this.request.json( this.api_url + '/app/get_role/v1', {
			id: this.role_id
		} );
		assert.ok( original_role_data.code === 0, 'original role still exists' );
		assert.deepEqual( original_role_data.role.privileges, { view_jobs: true }, 'original role privileges were not changed' );
		
		let { data:delete_user_data } = await this.request.json( this.api_url + '/user/admin_delete', {
			username: 'ut_role_manager'
		} );
		assert.ok( delete_user_data.code === 0, 'successful role manager fixture deletion' );
	},

    async function test_api_update_role_missing_id(test) {
        // update without id should error
        let { data } = await this.request.json( this.api_url + '/app/update_role/v1', { title: 'oops' } );
        assert.ok( !!data.code, 'expected error for missing id' );
    },

    async function test_api_update_role(test) {
        // update our role
        let { data } = await this.request.json( this.api_url + '/app/update_role/v1', {
            id: this.role_id,
            title: 'UTR v2',
            enabled: false,
            categories: ['general']
        });
        assert.ok( data.code === 0, 'successful api response' );
    },

    async function test_api_get_updated_role(test) {
        // verify updates
        let { data } = await this.request.json( this.api_url + '/app/get_role/v1', { id: this.role_id } );
        assert.ok( data.code === 0, 'successful api response' );
        assert.ok( data.role && data.role.title === 'UTR v2', 'unexpected role title' );
        assert.ok( data.role.enabled === false, 'unexpected role enabled flag' );
        assert.ok( Array.isArray(data.role.categories) && data.role.categories[0] === 'general', 'unexpected categories content' );
    },

    async function test_api_delete_role_missing_id(test) {
        // delete without id should error
        let { data } = await this.request.json( this.api_url + '/app/delete_role/v1', {} );
        assert.ok( !!data.code, 'expected error for missing id' );
    },

    async function test_api_delete_role_nonexistent(test) {
        // delete non-existent role should error
        let { data } = await this.request.json( this.api_url + '/app/delete_role/v1', { id: 'nope' } );
        assert.ok( !!data.code, 'expected error for missing role' );
    },

    async function test_api_delete_role(test) {
        // delete our role
        let { data } = await this.request.json( this.api_url + '/app/delete_role/v1', { id: this.role_id } );
        assert.ok( data.code === 0, 'successful api response' );
    },

    async function test_api_get_role_deleted(test) {
        // ensure deleted
        let { data } = await this.request.json( this.api_url + '/app/get_role/v1', { id: this.role_id } );
        assert.ok( !!data.code, 'expected error for missing role' );
        delete this.role_id;
    }

];
