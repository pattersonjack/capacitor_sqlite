import assert from 'node:assert/strict';
import { test } from 'node:test';
import plugin from '../dist/plugin.cjs.js';

const { SQLiteDBConnection } = plugin;

test('ordered queries preserve SQL, parameter values and positional rows', async () => {
  const statement = 'SELECT ? AS "2", ? AS "1", ? AS value, ? AS value';
  const values = ["'); DROP TABLE items; -- returning", 'second', null, { type: 'Buffer', data: [0, 255] }];
  const rows = [[values[0], 'second', null, [0, 255]]];
  const db = new SQLiteDBConnection('test', false, {
    async query(options) {
      assert.deepEqual(options, { database: 'test', statement, values, readonly: false, rowMode: 'array' });
      return { values: rows };
    },
  });

  assert.deepEqual(await db.queryValues(statement, values), { values: rows });
});

test('ordered queries preserve empty results and read-only connection selection', async () => {
  const db = new SQLiteDBConnection('test', true, {
    async query(options) {
      assert.equal(options.readonly, true);
      assert.deepEqual(options.values, []);
      return { values: [] };
    },
  });

  assert.deepEqual(await db.queryValues('SELECT 1 WHERE 0'), { values: [] });
});

test('ordered queries reject object rows from an incompatible native build', async () => {
  const db = new SQLiteDBConnection('test', false, {
    async query() {
      return { values: [{ value: 1 }] };
    },
  });

  await assert.rejects(db.queryValues('SELECT 1'), /did not return ordered rows/);
});

test('existing query keeps the object result contract', async () => {
  const db = new SQLiteDBConnection('test', false, {
    async query(options) {
      assert.equal(options.rowMode, undefined);
      return { values: [{ value: 1 }] };
    },
  });

  assert.deepEqual(await db.query('SELECT 1 AS value'), { values: [{ value: 1 }] });
});

test('single-statement execution forwards unchanged SQL and bound parameters', async () => {
  const statement = "UPDATE items SET value = ? WHERE value = 'a returning b--c'";
  const values = ["'; DELETE FROM items; --"];
  const result = { changes: { changes: 1, lastId: 1 } };
  const db = new SQLiteDBConnection('test', false, {
    async executeStatement(options) {
      assert.deepEqual(options, { database: 'test', statement, values });
      return result;
    },
  });

  assert.deepEqual(await db.executeStatement(statement, values), result);
});

test('single-statement execution rejects a read-only connection before calling native code', async () => {
  const db = new SQLiteDBConnection('test', true, {
    async executeStatement() {
      assert.fail('A read-only write must not reach native code');
    },
  });

  await assert.rejects(db.executeStatement('DELETE FROM items'), /read-only/);
});

test('native errors are propagated unchanged', async () => {
  const failure = new Error('binding failed');
  const db = new SQLiteDBConnection('test', false, {
    async executeStatement() {
      throw failure;
    },
  });

  await assert.rejects(db.executeStatement('SELECT ?', [1]), (error) => error === failure);
});
