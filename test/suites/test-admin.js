const assert = require('node:assert/strict');
const async = require('async');
const fs = require('node:fs');
const { Writable } = require('node:stream');
const Tools = require('pixl-tools');
const Admin = require('../../lib/api/admin.js');

// Run the bulk exporter against a small, synchronous mock.  This gives us a
// deterministic way to close the response between two top-level export items.
function runMockAdminExport(opts) {
	return new Promise( function(resolve, reject) {
		var admin = new Admin();
		var response = new Writable({
			write(chunk, encoding, callback) { callback(); }
		});
		var fetched = [];
		var callback_count = 0;
		var finished = 0;
		var updated = 0;
		var job = null;
		var searched = [];
		var indexed = [];
		
		response.setHeader = function() {};
		response.writeHead = function() {};
		
		admin.requireMaster = function() { return true; };
		admin.loadSession = function(args, callback) {
			callback(null, { id: 'session' }, { username: 'admin' });
		};
		admin.requireValidUser = function() { return true; };
		admin.requirePrivilege = function() { return true; };
		admin.logDebug = function() {};
		admin.logError = function() {};
		
		// Match the real internal-job behavior by removing convenience methods
		// when finish() is called.  The old exporter crashed on its next update().
		admin.startInternalJob = function() {
			job = {
				update() { updated++; },
				finish() {
					finished++;
					delete job.update;
					delete job.finish;
				}
			};
			return job;
		};
		
		admin.unbase = {
			indexes: {
				jobs: { id: 'jobs' },
				servers: { id: 'servers' }
			},
			get(index, id, callback) {
				indexed.push(index + '/' + id);
				callback(null, {
					id: id,
					log_file_size: 100,
					output: opts.output || ''
				});
			}
		};
		
		admin.storage = {
			searchRecords(query, index, callback) {
				searched.push(index.id);
				callback(null, (index.id === 'servers') ? {} : { job1: 1 });
			},
			get(key, callback) {
				fetched.push(key);
				if (opts.abort && key.match(/log\.txt\.gz$/)) response.emit('close');
				if (key.match(/log\.txt\.gz$/)) return callback(new Error('Not found'));
				callback(null, { first_page: 1, last_page: 0 });
			}
		};
		
		try {
			admin.api_admin_export_data({
				params: opts.params || { items: opts.items },
				query: opts.query || {},
				request: { headers: {} },
				response: response
			}, function() {
				callback_count++;
				setImmediate( function() {
					resolve({ fetched, searched, indexed, callback_count, finished, updated });
				});
			});
		}
		catch (err) {
			reject(err);
		}
	});
}

// helper: sleep
async function sleep(ms) {
  await new Promise(res => setTimeout(res, ms));
}

// helper: poll internal jobs until specified job id disappears (or title not found)
async function waitForJobGone(ctx, matcher, opts = {}) {
  const timeoutMs = opts.timeoutMs || 20000;
  const intervalMs = opts.intervalMs || 250;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let { data } = await ctx.request.json(ctx.api_url + '/app/get_internal_jobs/v1', {});
    if (data.code !== 0) throw new Error('get_internal_jobs failed');
    const rows = data.rows || [];
    let keepWaiting = false;
    if (typeof matcher === 'string') {
      keepWaiting = !!rows.find(r => r.id === matcher);
    }
    else if (matcher && matcher.title) {
      keepWaiting = !!rows.find(r => r.title === matcher.title);
    }
    else if (typeof matcher === 'function') {
      keepWaiting = !!rows.find(matcher);
    }
    else {
      // no matcher means wait for any jobs to disappear
      keepWaiting = rows.length > 0;
    }
    if (!keepWaiting) return;
    await sleep(intervalMs);
  }
  throw new Error('Timed out waiting for internal job to finish');
}

exports.tests = [

  async function test_admin_get_servers(test) {
    // get live snapshot of servers and conductor peers
    let { data } = await this.request.json(this.api_url + '/app/get_servers/v1', {});
    assert.ok(data.code === 0, 'successful api response');
    assert.ok(data.servers && typeof data.servers === 'object', 'expected servers object');
    assert.ok(data.masters && typeof data.masters === 'object', 'expected masters object');
    assert.ok(!!data.servers['satunit1'], 'expected satunit1 server present');
  },

  async function test_admin_get_global_state(test) {
    // fetch state pre-update
    let { data } = await this.request.json(this.api_url + '/app/get_global_state/v1', {});
    assert.ok(data.code === 0, 'successful api response');
    assert.ok(data.state && typeof data.state === 'object', 'expected state object');
  },

  async function test_admin_update_global_state(test) {
    // set an arbitrary state flag and verify
    let { data } = await this.request.json(this.api_url + '/app/update_global_state/v1', { unit_test: 1 });
    assert.ok(data.code === 0, 'successful api response');

    let { data: data2 } = await this.request.json(this.api_url + '/app/get_global_state/v1', {});
    assert.ok(data2.code === 0, 'successful state fetch');
    assert.ok(data2.state && data2.state.unit_test === 1, 'expected unit_test state flag');
  },

  async function test_admin_update_global_state_naughty_key(test) {
    // attempt to set a naughty key (should error)
    let { data } = await this.request.json(this.api_url + '/app/update_global_state/v1', { "__proto__.x": 1 });
    assert.ok(!!data.code, 'expected error for naughty key');
  },

  async function test_admin_internal_job_before(test) {
    // ensure our test job is not currently running
    let { data } = await this.request.json(this.api_url + '/app/get_internal_jobs/v1', {});
    assert.ok(data.code === 0, 'successful api response');
    const found = (data.rows || []).find(r => r.title === 'Test job that does nothing');
    assert.ok(!found, 'no existing test internal job running');
  },

  async function test_admin_test_internal_job(test) {
    // start the 1-second test job and verify it appears
    let { data } = await this.request.json(this.api_url + '/app/test_internal_job/v1', { duration: 1 });
    assert.ok(data.code === 0, 'successful api response');

    // fetch jobs to capture id
    let { data: jobs } = await this.request.json(this.api_url + '/app/get_internal_jobs/v1', {});
    assert.ok(jobs.code === 0, 'successful jobs fetch');
    const job = (jobs.rows || []).find(r => r.title === 'Test job that does nothing');
    assert.ok(!!job && !!job.id, 'expected test internal job present');
    this.test_job_id = job.id;
  },

  async function test_admin_wait_internal_job_done(test) {
    // wait until the test job disappears from the running list
    await waitForJobGone(this, this.test_job_id, { timeoutMs: 10000 });
    delete this.test_job_id;
  },

  async function test_admin_dash_stats_before(test) {
    // capture stats before reset
    let { data } = await this.request.json(this.api_url + '/app/dash_stats/v1', {});
    assert.ok(data.code === 0, 'successful api response');
    assert.ok(data.stats && data.stats.day && data.stats.day.transactions, 'expected day stats');
    this.server_add_before = (data.stats.day.transactions.server_add || 0);
  },

  async function test_admin_reset_daily_stats(test) {
    // reset daily stats
    let { data } = await this.request.json(this.api_url + '/app/admin_reset_daily_stats/v1', {});
    assert.ok(data.code === 0, 'successful api response');
  },

	async function test_admin_reset_job_rate_limits(test) {
		// Seed a live bucket, call the real authenticated API, and verify all current
		// windows are discarded without waiting for their natural expiration.
		const original_rate_limits = this.xy.jobRateLimits;
		try {
			this.xy.jobRateLimits = {
				'cap:unit-test-api': { count: 2, max: 2, expires: Tools.timeNow(true) + 3600 }
			};
			let { data } = await this.request.json(this.api_url + '/app/admin_reset_job_rate_limits/v1', {});
			assert.ok(data.code === 0, 'successful job rate limit reset response');
			assert.deepEqual(this.xy.jobRateLimits, {}, 'all job rate limit windows were reset');
		}
		finally {
			this.xy.jobRateLimits = original_rate_limits;
		}
	},

  async function test_admin_dash_stats_after(test) {
    // verify daily stats were reset (server_add is a good metric to check)
    let { data } = await this.request.json(this.api_url + '/app/dash_stats/v1', {});
    assert.ok(data.code === 0, 'successful api response');
    const after = (data.stats.day.transactions.server_add || 0);
    assert.ok(after <= this.server_add_before, 'server_add should not increase after reset');
  },

  async function test_admin_delete_data_tags(test) {
    // delete only the tags list via background internal job
    let { data } = await this.request.json(this.api_url + '/app/admin_delete_data/v1', {
      items: [ { type: 'list', key: 'global/tags' } ]
    });
    assert.ok(data.code === 0 && data.id, 'successful delete start with job id');
    await waitForJobGone(this, data.id, { timeoutMs: 20000 });
  },

  async function test_admin_import_data_tags(test) {
    // import sample tags from fixture via background job
    let { data: raw } = await this.request.post(this.api_url + '/app/admin_import_data/v1', {
      files: { file: 'test/fixtures/data-export-tags.txt' }
    });
    const body = (typeof raw === 'string') ? raw : raw.toString();
    let data = {};
    try { data = JSON.parse(body); }
    catch (err) { assert.ok(false, 'invalid JSON response for admin_import_data'); }
    assert.ok(data.code === 0 && data.id, 'successful import start with job id');
    await waitForJobGone(this, data.id, { timeoutMs: 30000 });
  },

	async function test_admin_import_reloads_secret_cache(test) {
		// Create a normal secret so we can capture a valid encrypted storage record.
		let { data: created } = await this.request.json( this.api_url + '/app/create_secret/v1', {
			title: 'Imported Cache Test',
			enabled: true,
			icon: '',
			notes: 'Imported by the admin regression test',
			plugins: ['shellplug'],
			categories: [],
			events: [],
			web_hooks: [],
			fields: [ { name: 'IMPORTED_CACHE_VALUE', value: 'cache-is-current' } ]
		});
		assert.equal( created.code, 0, 'created secret for import regression test' );
		
		var secret = created.secret;
		var encrypted = await new Promise( (resolve, reject) => {
			this.storage.get( 'secrets/' + secret.id, function(err, record) {
				if (err) return reject(err);
				resolve(record);
			});
		});
		
		// Delete the source record so the in-memory cache matches an empty destination.
		let { data: deleted } = await this.request.json( this.api_url + '/app/delete_secret/v1', { id: secret.id } );
		assert.equal( deleted.code, 0, 'deleted source secret before import' );
		assert.ok( !this.xy.secretCache[secret.id], 'secret cache is empty before import' );
		
		var import_file = 'test/temp/data-import-secret-cache.txt';
		var rows = [
			{ cmd: 'listDelete', args: ['global/secrets', false] },
			{ key: 'global/secrets', value: { page_size: 100, first_page: 0, last_page: 0, length: 1, type: 'list' } },
			{ key: 'global/secrets/0', value: { type: 'list_page', items: [secret] } },
			{ key: 'secrets/' + secret.id, value: encrypted }
		];
		fs.writeFileSync( import_file, rows.map( row => JSON.stringify(row) ).join("\n") + "\n" );
		
		try {
			// Import should make the secret immediately usable without a save or restart.
			let { data: raw } = await this.request.post(this.api_url + '/app/admin_import_data/v1', {
				files: { file: import_file }
			});
			var body = (typeof raw === 'string') ? raw : raw.toString();
			var imported = JSON.parse(body);
			assert.ok( imported.code === 0 && imported.id, 'started secret import job' );
			await waitForJobGone(this, imported.id, { timeoutMs: 30000 });
			
			assert.ok( this.xy.secretCache[secret.id], 'import populated the encrypted secret cache' );
			var env = this.xy.getSecretsForType('plugins', 'shellplug');
			assert.equal( env.IMPORTED_CACHE_VALUE, 'cache-is-current', 'runtime resolved imported secret value' );
			
			// The direct storage-backed UI path should agree with the runtime cache path.
			let { data: decrypted } = await this.request.json( this.api_url + '/app/decrypt_secret/v1', { id: secret.id } );
			assert.equal( decrypted.code, 0, 'UI API decrypted imported secret' );
			assert.equal( decrypted.fields[0].value, 'cache-is-current', 'UI and runtime secret values agree' );
		}
		finally {
			try { fs.unlinkSync(import_file); } catch (err) {;}
			if (this.xy.secrets.find( item => item.id == secret.id )) {
				await this.request.json( this.api_url + '/app/delete_secret/v1', { id: secret.id } );
			}
		}
	},

  async function test_admin_export_data_tags(test) {
    // request a transfer token for tags-only export
    let { data: tok } = await this.request.json(this.api_url + '/app/get_transfer_token/v1', {
      lists: ['tags'],
      indexes: [],
      extras: []
    });
    assert.ok(tok.code === 0 && tok.token, 'successful token creation');

    // download gzip file using token
    let url = this.api_url + '/app/admin_export_data/v1?token=' + encodeURIComponent(tok.token);
    let { data: gz } = await this.request.get(url);
    assert.ok(Buffer.isBuffer(gz) && gz.length > 0, 'received non-empty buffer');
    // gzip magic bytes 0x1f 0x8b
    assert.ok(gz[0] === 0x1f && gz[1] === 0x8b, 'buffer looks like gzip');
  },

	async function test_admin_export_data_accepts_scalar_selectors(test) {
		// HTTP query parsers produce strings for single values and arrays for
		// repeated values.  All three convenience selectors should accept both.
		var list_result = await runMockAdminExport({
			query: { lists: 'roles' }
		});
		var index_result = await runMockAdminExport({
			query: { indexes: 'jobs' }
		});
		var extra_result = await runMockAdminExport({
			query: { extras: 'monitor_data' }
		});
		
		assert.deepEqual(list_result.fetched, [ 'global/roles' ], 'exported scalar list selector');
		assert.deepEqual(index_result.searched, [ 'jobs' ], 'exported scalar index selector');
		assert.deepEqual(index_result.indexed, [ 'jobs/job1' ], 'loaded record from scalar index selector');
		assert.deepEqual(extra_result.searched, [ 'servers' ], 'exported scalar extra selector');
	},

	async function test_admin_export_data_skips_unrequested_job_logs(test) {
		// A small log must not bypass either the item.logs or job.output checks.
		var unrequested_result = await runMockAdminExport({
			items: [ { type: 'jobFiles', logs: false, files: false } ]
		});
		var inline_result = await runMockAdminExport({
			output: 'Inline job output',
			items: [ { type: 'jobFiles', logs: true, files: false } ]
		});
		
		assert.deepEqual(unrequested_result.fetched, [], 'did not fetch an unrequested job log');
		assert.deepEqual(inline_result.fetched, [], 'did not fetch an inline job log from storage');
		assert.equal(unrequested_result.finished, 1, 'finished the unrequested-log export job once');
		assert.equal(inline_result.finished, 1, 'finished the inline-log export job once');
	},

	async function test_admin_export_data_stops_after_disconnect(test) {
		// Simulate a disconnect during a benign missing-log error, with another
		// top-level item waiting.  The exporter must not call job.update() again.
		var result = await runMockAdminExport({
			abort: true,
			items: [
				{ type: 'jobFiles', logs: true, files: false },
				{ type: 'list', key: 'global/should-not-export' }
			]
		});
		
		assert.deepEqual(result.fetched, [ 'logs/jobs/job1/log.txt.gz' ], 'stopped before the next export item');
		assert.equal(result.updated, 1, 'did not update the finished internal job');
		assert.equal(result.finished, 1, 'finished the internal export job once');
		assert.equal(result.callback_count, 1, 'completed the API request once');
	},

  async function test_admin_logout_all(test) {
    // logout all sessions for admin user via background job
    let { data } = await this.request.json(this.api_url + '/app/admin_logout_all/v1', { username: 'admin' });
    assert.ok(data.code === 0 && data.id, 'successful logout start with job id');
    await waitForJobGone(this, data.id, { timeoutMs: 15000 });
  },

  async function test_admin_run_maintenance(test) {
    // run maintenance and wait for job completion
    let { data } = await this.request.json(this.api_url + '/app/admin_run_maintenance/v1', {});
    assert.ok(data.code === 0, 'successful api response');
    if (data.id) {
      await waitForJobGone(this, data.id, { timeoutMs: 60000 });
    }
    else {
      // fallback: match by title if server is on older API (no id)
      await waitForJobGone(this, { title: 'Daily maintenance manual run' }, { timeoutMs: 60000 });
    }
  },

  async function test_admin_stats(test) {
    // verify admin_stats returns rich stats structure
    let { data } = await this.request.json(this.api_url + '/app/admin_stats/v1', {});
    assert.ok(data.code === 0, 'successful api response');
    assert.ok(data.stats && typeof data.stats === 'object', 'expected stats object');
    assert.ok(!!data.stats.version, 'expected version');
    assert.ok(data.stats.db && typeof data.stats.db === 'object', 'expected db stats');
    assert.ok(data.stats.unbase && typeof data.stats.unbase === 'object', 'expected unbase stats');
    assert.ok(Array.isArray(data.stats.sockets), 'expected sockets array');
  },

  async function test_admin_run_optimization(test) {
    // run optimization if supported; gracefully handle not-required configs
    let { data } = await this.request.json(this.api_url + '/app/admin_run_optimization/v1', {});
    if (data.code === 0) {
      if (data.id) {
        await waitForJobGone(this, data.id, { timeoutMs: 120000 });
      }
      else {
        await waitForJobGone(this, { title: 'Database integrity and optimization' }, { timeoutMs: 120000 });
      }
    }
    else {
      // Accept environments that don't require optimization (non-SQLite)
      assert.ok(!!data.code, 'expected error for unsupported optimization');
    }
  }

];
