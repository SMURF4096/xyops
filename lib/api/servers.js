// xyOps API Layer - Servers
// Copyright (c) 2019 - 2026 PixlCore LLC
// Released under the BSD 3-Clause License.
// See the LICENSE.md file in this repository.

const fs = require('fs');
const assert = require("assert");
const async = require('async');
const Tools = require("pixl-tools");

class Servers {
	
	api_get_active_servers(args, callback) {
		// get list of all active servers from memory
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		if (!this.requireMaster(args, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var rows = self.getUserLimitedServers( self.getComputedUser(user) );
			
			callback({
				code: 0,
				rows: rows,
				list: { length: rows.length }
			});
		} ); // loaded session
	}
	
	api_get_active_server(args, callback) {
		// get single server record from memory
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		if (!this.requireMaster(args, callback)) return;
		
		if (!this.requireParams(params, {
			id: /^[a-z0-9_]+$/
		}, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var server = self.servers[params.id];
			if (!server) {
				return self.doError('notfound', "Failed to locate server: " + params.id, callback);
			}
			
			if (!self.requireTargetPrivilege(user, server.groups, callback)) return;
			
			callback({
				code: 0,
				server: server
			});
		} ); // loaded session
	}
	
	api_get_server(args, callback) {
		// get server from storage (including full minute monitoring data)
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		if (!this.requireMaster(args, callback)) return;
		
		if (!this.requireParams(params, {
			id: /^[a-z0-9_]+$/
		}, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			// load server host data
			var host_key = 'hosts/' + params.id + '/data';
			
			self.storage.get( host_key, function(err, data) {
				if (err) return self.doError('notfound', "Failed to load server data: " + err, callback);
				
				if (self.servers[params.id]) {
					// server is active
					var server = self.servers[params.id];
					if (!self.requireTargetPrivilege(user, server.groups, callback)) return;
					callback({ code: 0, server: server, data: data, online: true });
				}
				else if (self.serverCache[params.id]) {
					// server is recently deceased
					var server = self.serverCache[params.id];
					if (!self.requireTargetPrivilege(user, server.groups, callback)) return;
					callback({ code: 0, server: server, data: data, online: false });
				}
				else {
					// load server from db (offline)
					self.unbase.get( 'servers', params.id, function(err, server) {
						if (err) return self.doError('notfound', "Failed to locate server: " + params.id, callback);
						if (!self.requireTargetPrivilege(user, server.groups, callback)) return;
						callback({ code: 0, server: server, data: data, online: false });
					}); // unbase.get
				}
			} ); // storage.get
		} ); // loaded session
	}
	
	api_update_server(args, callback) {
		// update server in memory and in storage (i.e. enabled, title, icon, groups)
		// params: { id, title?, enabled?, icon?, groups?, autoGroup? }
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		if (!this.requireMaster(args, callback)) return;
		
		if (!this.requireParams(params, {
			id: /^[a-z0-9_]+$/
		}, callback)) return;
		if (('groups' in params) && !Tools.isaArray(params.groups)) {
			return this.doError('api', "Malformed server parameter: groups (must be array)", callback);
		}
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, 'update_servers', callback)) return;
			
			args.user = user;
			args.session = session;
			var cuser = self.getComputedUser(user);
			
			var finish = function(server) {
				// Check the current server scope before allowing any changes.
				if (!self.getUserLimitedServers(cuser, [server]).length) {
					return self.doError('access', "You do not have the required account privileges to access server ID " + params.id + ".", callback);
				}
				
				// Compute the final groups exactly as updateServer will, then check
				// the destination scope before mutating memory or storage.
				var groups = server.groups || [];
				if (params.autoGroup) {
					groups = self.groups.filter( function(group) {
						return server.hostname.match(group.hostname_match);
					} ).map( function(group) { return group.id; } );
				}
				else if ('groups' in params) groups = params.groups;
				
				if (!self.getUserLimitedServers(cuser, [{ groups: groups }]).length) {
					return self.doError('access', "You do not have the required account privileges to assign the requested server groups.", callback);
				}
				
				// Persist the exact auto-assigned destination we authorized, even
				// when the server is cached or offline rather than active in memory.
				if (params.autoGroup) params.groups = groups;
				
				self.updateServer(params.id, params, function(err) {
					if (err) return self.doError('server', "Failed to update server: " + err, callback);
					callback({ code: 0 });
					
					// log transaction
					self.logTransaction('server_update', '', self.getClientInfo(args, { 
						server_id: params.id,
						hostname: self.servers[params.id] ? self.servers[params.id].hostname : params.id,
						updates: params,
						keywords: [ params.id ]
					}));
					
				}); // updateServer
			}; // finish
			
			if (self.servers[params.id]) {
				// server is active
				var server = self.servers[params.id];
				finish(server);
			}
			else if (self.serverCache[params.id]) {
				// server is recently deceased
				var server = self.serverCache[params.id];
				finish(server);
			}
			else {
				// load server from db (offline)
				self.unbase.get( 'servers', params.id, function(err, server) {
					if (err) return self.doError('notfound', "Failed to locate server: " + params.id, callback);
					finish(server);
				}); // unbase.get
			}
			
		} ); // loaded session
	}
	
	api_update_server_data(args, callback) {
		// update server user data in memory and in storage
		// params: { id, data, replace? }
		var self = this;
		var params = args.params;
		if (!this.requireMaster(args, callback)) return;
		
		// allow userData or data
		if (!params.data && params.userData) {
			params.data = params.userData;
			delete params.userData;
		}
		
		if (!this.requireParams(params, {
			id: /^[a-z0-9_]+$/,
			data: 'object'
		}, callback)) return;
		
		if (!Tools.isaHash(params.data)) return this.doError('api', "Data parameter is not a plain object.", callback);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, 'update_servers', callback)) return;
			
			args.user = user;
			args.session = session;
			
			var server = self.servers[ params.id ] || null;
			var server_path = 'unbase/records/servers/' + params.id;
			
			self.logDebug(5, "Updating server user data: " + params.id, params);
			
			async.series([
				function(callback) {
					// lock record
					self.storage.lock( server_path, true, callback );
				},
				function(callback) {
					// load server if needed
					if (server) return process.nextTick(callback);
					
					self.storage.get( server_path, function(err, data) {
						if (err) return callback(err);
						server = data;
						callback();
					} );
				},
				function(callback) {
					// apply updates
					if (!self.checkTargetPrivilege(user, server.groups)) return callback("Insufficient privileges");
					
					if (!server.userData) server.userData = {};
					if (params.replace) server.userData = params.data;
					else Tools.mergeHashInto( server.userData, params.data );
					
					// save record back to storage (no index)
					self.storage.put( server_path, server, function(err) {
						callback(err);
					} );
				}
			],
			function(err) {
				self.storage.unlock( server_path );
				if (err) return self.doError('server', "Failed to update server data: " + err, callback);
				callback({ code: 0, data: server.userData });
			}); // async.series
		} ); // loaded session
	}
	
	api_delete_server(args, callback) {
		// permanently delete server, and possibly monitoring data as well
		// params: { id, history? }
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		if (!this.requireMaster(args, callback)) return;
		
		if (!this.requireParams(params, {
			id: /^[a-z0-9_]+$/
		}, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireAdmin(session, user, callback)) return;
			
			args.user = user;
			args.session = session;
			
			if (self.servers[params.id]) {
				// server is online
				var server = self.servers[ params.id ];
				var socket = self.sockets[ server.socket_id ];
				if (!socket) {
					// should never happen, mostly a sanity check
					return self.doError('server', "Server has no socket connection: " + params.id, callback);
				}
				
				// add hint to perform actions after removal
				if (params.history) server.delete = { params, username: user.username || user.id };
				
				// send uninstall command -- the eventual socket closing will continue the process
				socket.send('uninstall', {});
			}
			else if (params.history) {
				// server is offline
				self.deleteServer({ id: params.id, delete: { params, username: user.username || user.id } });
			}
			else {
				// server is offline but user said do not delete monitoring data, so there's nothing to do
				return self.doError('server', "Server has gone offline: " + params.id, callback);
			}
			
			// send response
			callback({ code: 0 });
			
			// log transaction
			self.logTransaction('server_delete', '', self.getClientInfo(args, { 
				server_id: params.id,
				hostname: self.servers[params.id] ? self.servers[params.id].hostname : params.id,
				keywords: [ params.id ]
			}));
			
		}); // loaded session
	}
	
	api_watch_server(args, callback) {
		// set a watch on a server (takes snaps every minute for specified duration)
		// to cancel a watch, set duration to 0
		// params: { id, duration }
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		if (!this.requireMaster(args, callback)) return;
		
		if (!this.requireParams(params, {
			id: /^[a-z0-9_]+$/,
			duration: /^\d+$/
		}, callback)) return;
		
		// HTTP GET query parameters arrive as strings.  Normalize this here so
		// the expiration calculation below always performs numeric addition.
		params.duration = parseInt( params.duration );
		
		var nice_duration = Tools.getTextFromSeconds(params.duration, false, true);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, 'create_snapshots', callback)) return;
			
			var server = self.servers[params.id];
			if (!server) return self.doError('server', "Failed to locate server: " + params.id, callback);
			if (!self.requireTargetPrivilege(user, server.groups, callback)) return;
			
			args.user = user;
			args.session = session;
			
			if (params.duration) {
				self.logDebug(6, "Setting watch on server: " + params.id + ": " + nice_duration, params);
				self.putState( `watches.servers.${params.id}`, Tools.timeNow(true) + params.duration );
			}
			else {
				self.logDebug(6, "Removing watch on server: " + params.id, params);
				self.deleteState( `watches.servers.${params.id}` );
			}
			
			callback({ code: 0 });
			
			// send updated state for current user (all others will get it on the next tick)
			self.doUserBroadcast( session.username, 'update', { state: self.state } );
			
			// log transaction
			self.logTransaction('server_watch', '', self.getClientInfo(args, { 
				server_id: params.id,
				hostname: self.servers[params.id].hostname,
				duration: params.duration ? nice_duration : '0 seconds (disabled)',
				seconds: params.duration,
				keywords: [ params.id ]
			}));
			
		} ); // loaded session
	}
	
	// Snapshot APIs:
	
	api_create_snapshot(args, callback) {
		// add new snapshot for server
		// use host data already saved in last minute
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		if (!this.requireMaster(args, callback)) return;
		
		if (!this.requireParams(params, {
			server: /^\w+$/
		}, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, 'create_snapshots', callback)) return;
			
			var server = self.servers[params.server];
			if (!server) return self.doError('server', "Unknown or inactive server: " + params.server, callback);
			if (!self.requireTargetPrivilege(user, server.groups, callback)) return;
			
			self.createSnapshot(params.server, { source: 'user', username: user.username }, function(err, id) {
				if (err) return self.doError('snapshot', "Failed to create snapshot: " + err, callback);
				callback({ code: 0, id: id });
			}); // createSnapshot
			
		} ); // loadSession
	}
	
	api_delete_snapshot(args, callback) {
		// delete snapshot
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		if (!this.requireMaster(args, callback)) return;
		
		if (!this.requireParams(params, {
			id: /^[a-z0-9_]+$/
		}, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, 'delete_snapshots', callback)) return;
			
			var grps = self.getComputedGroups(user);
			if (grps.length) return self.doError('alert', "Group-limited users may not delete server snapshots.", callback);
			
			self.logDebug(6, "Deleting server snapshot: " + params.id);
			
			self.unbase.delete( 'snapshots', params.id, function(err) {
				if (err) return self.doError('snapshot', "Failed to delete snapshot: " + err, callback);
				callback({ code: 0 });
			} );
			
		} ); // loadSession
	}
	
} // class Servers

module.exports = Servers;
