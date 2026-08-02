const assert = require('node:assert/strict');
const Tools = require('pixl-tools');

exports.tests = [

	async function test_api_get_monitors(test) {
		// list all monitors
		let { data } = await this.request.json( this.api_url + '/app/get_monitors/v1', {} );
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( Array.isArray(data.rows), 'expected rows array' );
		assert.ok( data.list && (data.list.length >= 0), 'expected list metadata' );
	},

	async function test_api_get_monitor_missing_param(test) {
		// fetch missing id
		let { data } = await this.request.json( this.api_url + '/app/get_monitor/v1', {} );
		assert.ok( !!data.code, 'expected error for missing id' );
	},

	async function test_api_get_monitor_missing(test) {
		// fetch non-existent monitor
		let { data } = await this.request.json( this.api_url + '/app/get_monitor/v1', { id: 'nope' } );
		assert.ok( !!data.code, 'expected error for missing monitor' );
	},

	async function test_api_create_monitor_missing_title(test) {
		// missing required title
		let { data } = await this.request.json( this.api_url + '/app/create_monitor/v1', {
			id: 'ut_mon1',
			source: 'cpu.currentLoad',
			data_type: 'float'
		});
		assert.ok( !!data.code, 'expected error for missing title' );
	},

	async function test_api_create_monitor_missing_source(test) {
		// missing required source
		let { data } = await this.request.json( this.api_url + '/app/create_monitor/v1', {
			id: 'ut_mon2',
			title: 'UT Monitor 2',
			data_type: 'float'
		});
		assert.ok( !!data.code, 'expected error for missing source' );
	},

	async function test_api_create_monitor_missing_data_type(test) {
		// missing required data_type
		let { data } = await this.request.json( this.api_url + '/app/create_monitor/v1', {
			id: 'ut_mon3',
			title: 'UT Monitor 3',
			source: 'cpu.currentLoad'
		});
		assert.ok( !!data.code, 'expected error for missing data_type' );
	},

	async function test_api_create_monitor(test) {
		// create a new monitor
		let { data } = await this.request.json( this.api_url + '/app/create_monitor/v1', {
			// omit id to test auto-generation
			title: 'CPU Usage % (UT)',
			source: 'cpu.currentLoad',
			data_type: 'float',
			suffix: '%',
			display: true,
			min_vert_scale: 100,
			groups: []
		});
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( data.monitor && data.monitor.id, 'expected monitor in response' );
		this.monitor_id = data.monitor.id;
	},

	async function test_api_get_new_monitor(test) {
		// fetch our monitor
		let { data } = await this.request.json( this.api_url + '/app/get_monitor/v1', { id: this.monitor_id } );
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( data.monitor && data.monitor.id === this.monitor_id, 'monitor id unexpected' );
		assert.ok( data.monitor.title === 'CPU Usage % (UT)', 'unexpected monitor title' );
	},

	async function test_api_update_monitor_missing_id(test) {
		// update without id should error
		let { data } = await this.request.json( this.api_url + '/app/update_monitor/v1', { title: 'oops' } );
		assert.ok( !!data.code, 'expected error for missing id' );
	},

	async function test_api_update_monitor(test) {
		// update our monitor
		let { data } = await this.request.json( this.api_url + '/app/update_monitor/v1', {
			id: this.monitor_id,
			notes: 'unit test notes',
			suffix: '% CPU'
		});
		assert.ok( data.code === 0, 'successful api response' );
	},

	async function test_api_get_updated_monitor(test) {
		// verify updates
		let { data } = await this.request.json( this.api_url + '/app/get_monitor/v1', { id: this.monitor_id } );
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( data.monitor && data.monitor.notes === 'unit test notes', 'unexpected monitor notes' );
		assert.ok( data.monitor.suffix === '% CPU', 'unexpected monitor suffix' );
	},

	async function test_api_test_monitor(test) {
		// test monitor evaluation on live server data
		let { data } = await this.request.json( this.api_url + '/app/test_monitor/v1', {
			server: 'satunit1',
			source: 'cpu.currentLoad',
			data_type: 'float'
		});
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( typeof data.value === 'number', 'expected numeric value' );
	},

	async function test_api_test_monitor_missing_server(test) {
		// missing server should error
		let { data } = await this.request.json( this.api_url + '/app/test_monitor/v1', {
			source: 'cpu.currentLoad',
			data_type: 'float'
		});
		assert.ok( !!data.code, 'expected error for missing server' );
	},

	async function test_api_test_monitor_missing_source(test) {
		// missing source should error
		let { data } = await this.request.json( this.api_url + '/app/test_monitor/v1', {
			server: 'satunit1',
			data_type: 'float'
		});
		assert.ok( !!data.code, 'expected error for missing source' );
	},

	async function test_api_test_monitor_missing_data_type(test) {
		// missing data_type should error
		let { data } = await this.request.json( this.api_url + '/app/test_monitor/v1', {
			server: 'satunit1',
			source: 'cpu.currentLoad'
		});
		assert.ok( !!data.code, 'expected error for missing data_type' );
	},

	async function test_api_get_quickmon_data_all(test) {
		// get quickmon data for all servers
		let { data } = await this.request.json( this.api_url + '/app/get_quickmon_data/v1', {} );
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( data.servers && data.servers.satunit1, 'expected satunit1 in quickmon servers' );
		assert.ok( Array.isArray(data.servers.satunit1), 'expected quickmon array for satunit1' );
		assert.ok( data.servers.satunit1.length >= 0, 'expected quickmon length present' );
	},

	async function test_api_get_quickmon_data_server(test) {
		// get quickmon data for a single server
		let { data } = await this.request.json( this.api_url + '/app/get_quickmon_data/v1', { server: 'satunit1' } );
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( data.servers && data.servers.satunit1, 'expected satunit1 in quickmon servers' );
		assert.ok( Array.isArray(data.servers.satunit1), 'expected quickmon array for satunit1' );
	},

	async function test_api_get_latest_monitor_data(test) {
		// fetch latest timeline entries + current snapshot
		let { data } = await this.request.json( this.api_url + '/app/get_latest_monitor_data/v1', {
			server: 'satunit1',
			sys: 'hourly',
			limit: 3
		});
		assert.ok( data.code === 0, 'successful api response' );
		assert.ok( Array.isArray(data.rows), 'expected rows array' );
		assert.ok( data.rows.length >= 0, 'expected rows length present' );
		assert.ok( data.data && data.data.data, 'expected server data snapshot present' );
	},

	async function test_api_get_historical_monitor_data(test) {
		// fetch historical timeline entries for current time window
		const now = Tools.timeNow(true) - 60; // last minute, in case we cross the minute boundary during the test run
		let { data } = await this.request.json( this.api_url + '/app/get_historical_monitor_data/v1', {
			server: 'satunit1',
			sys: 'hourly',
			date: now,
			limit: 3
		});
		assert.ok( data.code === 0, 'successful api response' );
		// Expect at least one record; if this fails, mock data may not be indexed yet
		assert.ok( Array.isArray(data.rows), 'expected rows array' );
		assert.ok( data.rows.length >= 1, 'expected at least one historical row' );
	},
	
	async function test_monitor_data_group_restrictions(test) {
		// Concrete monitoring data is server-scoped even though monitor
		// definitions themselves remain visible to all authenticated users.
		let created = await this.request.json( this.api_url + '/app/create_api_key/v1', {
			title: 'Unit Test Restricted Monitor API Key',
			description: 'Created by monitor unit tests',
			active: 1,
			privileges: {},
			groups: ['forbidden_group']
		});
		assert.ok( created.data.code === 0, 'successful restricted api key creation' );
		
		var key_id = created.data.api_key.id;
		var plain_key = created.data.plain_key;
		var key_opts = {
			headers: { 'X-Session-ID': '', 'X-API-Key': plain_key }
		};
		
		try {
			let all = await this.request.json( this.api_url + '/app/get_quickmon_data/v1', {}, key_opts );
			assert.ok( all.data.code === 0, 'restricted quickmon list succeeds' );
			assert.ok( !all.data.servers.satunit1, 'forbidden server omitted from quickmon list' );
			
			let single = await this.request.json( this.api_url + '/app/get_quickmon_data/v1', { server: 'satunit1' }, key_opts );
			assert.ok( single.data.code === 'access', 'forbidden quickmon server is rejected' );
			
			let group = await this.request.json( this.api_url + '/app/get_quickmon_data/v1', { group: this.group_final_id }, key_opts );
			assert.ok( group.data.code === 'access', 'forbidden quickmon group is rejected' );
			
			let latest = await this.request.json( this.api_url + '/app/get_latest_monitor_data/v1', {
				server: 'satunit1', sys: 'hourly', limit: 3
			}, key_opts );
			assert.ok( latest.data.code === 'access', 'forbidden latest monitor data is rejected' );
			
			let historical = await this.request.json( this.api_url + '/app/get_historical_monitor_data/v1', {
				server: 'satunit1', sys: 'hourly', date: Tools.timeNow(true), limit: 3
			}, key_opts );
			assert.ok( historical.data.code === 'access', 'forbidden historical monitor data is rejected' );
			
			// Confirm this is resource filtering, not a blanket API-key ban.
			let updated = await this.request.json( this.api_url + '/app/update_api_key/v1', {
				id: key_id,
				groups: [this.group_final_id]
			});
			assert.ok( updated.data.code === 0, 'api key updated to allowed group' );
			
			single = await this.request.json( this.api_url + '/app/get_quickmon_data/v1', { server: 'satunit1' }, key_opts );
			assert.ok( single.data.code === 0 && single.data.servers.satunit1, 'allowed quickmon server is returned' );
			
			latest = await this.request.json( this.api_url + '/app/get_latest_monitor_data/v1', {
				server: 'satunit1', sys: 'hourly', limit: 3
			}, key_opts );
			assert.ok( latest.data.code === 0 && latest.data.data, 'allowed latest monitor data is returned' );
		}
		finally {
			await this.request.json( this.api_url + '/app/delete_api_key/v1', { id: key_id } );
		}
	},

	async function test_api_delete_monitor_missing_id(test) {
		// delete without id should error
		let { data } = await this.request.json( this.api_url + '/app/delete_monitor/v1', {} );
		assert.ok( !!data.code, 'expected error for missing id' );
	},

	async function test_api_delete_monitor_missing(test) {
		// delete non-existent monitor should error
		let { data } = await this.request.json( this.api_url + '/app/delete_monitor/v1', { id: 'nope' } );
		assert.ok( !!data.code, 'expected error for missing monitor' );
	},

	async function test_api_delete_monitor(test) {
		// delete our monitor
		let { data } = await this.request.json( this.api_url + '/app/delete_monitor/v1', { id: this.monitor_id } );
		assert.ok( data.code === 0, 'successful api response' );
	},

	async function test_api_get_monitor_deleted(test) {
		// ensure deleted
		let { data } = await this.request.json( this.api_url + '/app/get_monitor/v1', { id: this.monitor_id } );
		assert.ok( !!data.code, 'expected error for missing monitor' );
		delete this.monitor_id;
	},

	async function test_api_stub_multi_update_monitor(test) {
		// stubbed: skip multi_update_monitor
		assert.ok(true, 'stub multi_update_monitor');
	}

];
