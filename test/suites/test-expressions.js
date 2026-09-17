// xyOps Expression Helper Tests
// Copyright (c) 2019 - 2026 PixlCore LLC
// Released under the BSD 3-Clause License.
// See the LICENSE.md file in this repository.

const assert = require('node:assert/strict');
const jexl = require('jexl');

// Evaluate expressions using the helpers registered during server startup.
// This exercises the public JEXL syntax as well as the helper implementations.
exports.tests = [
	
	async function test_expression_total_numbers(test) {
		// Include zero, negative and fractional values in the numeric array.
		assert.equal(jexl.evalSync('total([10, 20, 30])'), 60, 'total of positive numbers');
		assert.equal(jexl.evalSync('total([-10, 0, 2.5])'), -7.5, 'total of mixed numeric values');
	},
	
	async function test_expression_total_objects(test) {
		// Other numeric properties should not contribute to the selected total.
		var context = {
			items: [
				{ amount: -10, other: 100 },
				{ amount: 0, other: 200 },
				{ amount: 2.5, other: 300 }
			]
		};
		
		assert.equal(jexl.evalSync("total(items, 'amount')", context), -7.5, 'total of selected object sub-key');
	},
	
	async function test_expression_total_dot_path(test) {
		// Traverse multiple levels and ignore unrelated values along the path.
		var context = {
			items: [
				{ stats: { memory: { bytes: -10 }, bytes: 100 } },
				{ stats: { memory: { bytes: 0 }, bytes: 200 } },
				{ stats: { memory: { bytes: 2.5 }, bytes: 300 } }
			]
		};
		
		assert.equal(jexl.evalSync("total(items, 'stats.memory.bytes')", context), -7.5, 'total of nested numeric values');
	},
	
	async function test_expression_total_empty(test) {
		// An empty array has a total of zero with numbers, keys or dot paths.
		assert.equal(jexl.evalSync('total([])'), 0, 'total of empty numeric array');
		assert.equal(jexl.evalSync("total([], 'amount')"), 0, 'total of empty object array');
		assert.equal(jexl.evalSync("total([], 'stats.memory.bytes')"), 0, 'total of empty array with dot path');
	},
	
	async function test_expression_average_numbers(test) {
		// Verify the arithmetic mean retains fractional results and counts zeros.
		assert.equal(jexl.evalSync('average([10, 20, 30])'), 20, 'average of positive numbers');
		assert.equal(jexl.evalSync('average([1, 2])'), 1.5, 'fractional average of integers');
		assert.equal(jexl.evalSync('average([-10, 0, 2.5])'), -2.5, 'average of mixed numeric values');
	},
	
	async function test_expression_average_objects(test) {
		// Average only the selected property, including objects with a zero value.
		var context = {
			items: [
				{ amount: -10, other: 100 },
				{ amount: 0, other: 200 },
				{ amount: 2.5, other: 300 }
			]
		};
		
		assert.equal(jexl.evalSync("average(items, 'amount')", context), -2.5, 'average of selected object sub-key');
	},
	
	async function test_expression_average_dot_path(test) {
		// Include a nested zero value in the count used to calculate the mean.
		var context = {
			items: [
				{ stats: { memory: { bytes: -10 }, bytes: 100 } },
				{ stats: { memory: { bytes: 0 }, bytes: 200 } },
				{ stats: { memory: { bytes: 2.5 }, bytes: 300 } }
			]
		};
		
		assert.equal(jexl.evalSync("average(items, 'stats.memory.bytes')", context), -2.5, 'average of nested numeric values');
	},
	
	async function test_expression_average_empty(test) {
		// Empty arrays return zero rather than dividing by zero.
		assert.equal(jexl.evalSync('average([])'), 0, 'average of empty numeric array');
		assert.equal(jexl.evalSync("average([], 'amount')"), 0, 'average of empty object array');
		assert.equal(jexl.evalSync("average([], 'stats.memory.bytes')"), 0, 'average of empty array with dot path');
	},
	
	async function test_expression_find_key(test) {
		// Preserve plain-key substring matching and return the matching objects.
		var context = {
			items: [
				{ name: 'daily backup' },
				{ name: 'other' },
				{ name: 'backup weekly' }
			]
		};
		
		assert.deepEqual(jexl.evalSync("find(items, 'name', 'backup')", context), [context.items[0], context.items[2]], 'find all matching objects by plain key');
		assert.deepEqual(jexl.evalSync("find(items, 'name', 'missing')", context), [], 'find returns empty array without matches');
	},
	
	async function test_expression_find_dot_path(test) {
		// Match nested names, rather than the unrelated top-level name property.
		var context = {
			items: [
				{ name: 'other', details: { name: 'daily backup' }, stats: { size: -10 } },
				{ name: 'backup', details: { name: 'other' }, stats: { size: 100 } },
				{ name: 'other', details: { name: 'backup weekly' }, stats: { size: 2.5 } }
			]
		};
		
		assert.deepEqual(jexl.evalSync("find(items, 'details.name', 'backup')", context), [context.items[0], context.items[2]], 'find all matching objects by dot path');
		assert.deepEqual(jexl.evalSync("find(items, 'details.name', 'missing')", context), [], 'nested find returns empty array without matches');
		assert.deepEqual(jexl.evalSync("find([], 'details.name', 'backup')"), [], 'nested find accepts empty array');
		
		// Use the matching objects directly in aggregations with nested values.
		assert.equal(jexl.evalSync("total(find(items, 'details.name', 'backup'), 'stats.size')", context), -7.5, 'total of nested values in matching objects');
		assert.equal(jexl.evalSync("average(find(items, 'details.name', 'backup'), 'stats.size')", context), -3.75, 'average of nested values in matching objects');
	}
	
];
