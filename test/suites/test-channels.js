const assert = require('node:assert/strict');
const Tools = require('pixl-tools');
const Actions = require('../../lib/action.js');
const AlertSystem = require('../../lib/alert.js');

exports.tests = [

	async function test_api_get_channels(test) {
		// list all channels
		let { data } = await this.request.json( this.api_url + '/app/get_channels/v1', {} );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( Array.isArray(data.rows), "expected rows array" );
		assert.ok( data.list && (data.list.length >= 0), "expected list metadata" );
	},

	async function test_api_get_channel_missing_param(test) {
		// missing id param
		let { data } = await this.request.json( this.api_url + '/app/get_channel/v1', {} );
		assert.ok( !!data.code, "expected error for missing id" );
	},

	async function test_api_get_channel_missing(test) {
		// non-existent channel
		let { data } = await this.request.json( this.api_url + '/app/get_channel/v1', { id: 'nope' } );
		assert.ok( !!data.code, "expected error for missing channel" );
	},

	async function test_api_create_channel_missing_title(test) {
		// missing required title
		let { data } = await this.request.json( this.api_url + '/app/create_channel/v1', { enabled: true } );
		assert.ok( !!data.code, "expected error for missing title" );
	},

	async function test_email_only_channel_without_users(test) {
		// Email-only channels created through the API may omit the users array.
		// Exercise both channel dispatchers without delivering an actual email.
		let { data } = await this.request.json( this.api_url + '/app/create_channel/v1', {
			title: "Unit Test Email-Only Channel",
			enabled: true,
			email: "unit-test@example.com"
		});
		assert.equal( data.code, 0, "email-only channel was created" );
		assert.ok( data.channel && data.channel.id, "expected channel in response" );
		assert.equal( data.channel.users, undefined, "test channel omits users array" );
		
		const deliveries = [];
		const channel = data.channel;
		const common = {
			channels: [channel],
			getDailyCustomStat() { return 0; },
			updateDailyCustomStat() {}
		};
		const actions = Object.assign(new Actions(), common, {
			appendMetaLog() {},
			logAction() {},
			runJobAction_email(job, action, callback) {
				deliveries.push({ source: 'job', email: action.email });
				callback();
			}
		});
		const alerts = Object.assign(new AlertSystem(), common, {
			logAlert() {},
			runAlertAction_email(action, args, callback) {
				deliveries.push({ source: 'alert', email: action.email });
				callback();
			}
		});
		
		try {
			await new Promise( resolve => actions.runJobAction_channel(
				{ id: 'unit-test-job' },
				{ condition: 'success', channel_id: channel.id },
				resolve
			) );
			await new Promise( resolve => alerts.runAlertAction_channel(
				{ condition: 'alert_new', channel_id: channel.id },
				{},
				resolve
			) );
			
			assert.deepEqual( deliveries, [
				{ source: 'job', email: 'unit-test@example.com' },
				{ source: 'alert', email: 'unit-test@example.com' }
			], "both channel dispatchers processed the email-only channel" );
		}
		finally {
			let { data } = await this.request.json( this.api_url + '/app/delete_channel/v1', { id: channel.id } );
			assert.equal( data.code, 0, "email-only test channel was deleted" );
		}
	},

	async function test_api_create_channel(test) {
		// create new channel
		let { data } = await this.request.json( this.api_url + '/app/create_channel/v1', {
			"title": "Unit Test Channel",
			"enabled": true,
			"notes": "Created by unit tests",
			"users": ["admin"],
			"email": "",
			"web_hook": "",
			"run_event": "",
			"sound": "attention-3.mp3",
			"icon": "",
			"max_per_day": 0
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.channel && data.channel.id, "expected channel in response" );
		this.channel_id = data.channel.id;
	},

	async function test_api_get_new_channel(test) {
		// fetch our channel
		let { data } = await this.request.json( this.api_url + '/app/get_channel/v1', { id: this.channel_id } );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.channel && data.channel.id === this.channel_id, "channel id unexpected" );
		assert.ok( data.channel.title === 'Unit Test Channel', "unexpected channel title" );
		assert.ok( Array.isArray(data.channel.users), "expected users array" );
	},

	async function test_api_update_channel_missing_id(test) {
		// update without id should error
		let { data } = await this.request.json( this.api_url + '/app/update_channel/v1', { title: 'oops' } );
		assert.ok( !!data.code, "expected error for missing id" );
	},

	async function test_api_update_channel(test) {
		// update our channel
		let { data } = await this.request.json( this.api_url + '/app/update_channel/v1', {
			id: this.channel_id,
			title: 'UTCNL v2',
			max_per_day: 5
		});
		assert.ok( data.code === 0, "successful api response" );
	},

	async function test_api_get_updated_channel(test) {
		// verify updates
		let { data } = await this.request.json( this.api_url + '/app/get_channel/v1', { id: this.channel_id } );
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.channel && data.channel.title === 'UTCNL v2', "unexpected channel title" );
		assert.ok( data.channel.max_per_day === 5, "unexpected max_per_day" );
	},

	async function test_api_delete_channel_missing_id(test) {
		// delete without id should error
		let { data } = await this.request.json( this.api_url + '/app/delete_channel/v1', {} );
		assert.ok( !!data.code, "expected error for missing id" );
	},

	async function test_api_delete_channel_nonexistent(test) {
		// delete non-existent channel should error
		let { data } = await this.request.json( this.api_url + '/app/delete_channel/v1', { id: 'nope' } );
		assert.ok( !!data.code, "expected error for missing channel" );
	},

	async function test_api_delete_channel(test) {
		// delete our channel
		let { data } = await this.request.json( this.api_url + '/app/delete_channel/v1', { id: this.channel_id } );
		assert.ok( data.code === 0, "successful api response" );
	},

	async function test_api_get_channel_deleted(test) {
		// ensure deleted
		let { data } = await this.request.json( this.api_url + '/app/get_channel/v1', { id: this.channel_id } );
		assert.ok( !!data.code, "expected error for missing channel" );
		delete this.channel_id;
	},

	async function test_api_create_channel_final(test) {
		// create a final channel for other suites
		let { data } = await this.request.json( this.api_url + '/app/create_channel/v1', {
			"title": "Unit Test Channel Final",
			"enabled": true,
			"notes": "Keep me for future tests",
			"users": ["admin"],
			"sound": "attention-3.mp3"
		});
		assert.ok( data.code === 0, "successful api response" );
		assert.ok( data.channel && data.channel.id, "expected channel in response" );
		this.channel_final_id = data.channel.id;
	}

];
