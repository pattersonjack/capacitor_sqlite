# Ordered rows and unchanged single statements

This fork adds a narrow native API for ORM drivers. Existing `query`, `execute` and `run` signatures remain available. Android is validated by Aurora's emulator proof; iOS code is implemented but still requires a Mac build and native tests. Web and Electron reject the new operations explicitly.

```ts
// db is an open SQLiteDBConnection; the caller owns its lifetime.
await db.executeStatement('CREATE TABLE entries (value TEXT)');
await db.executeStatement('INSERT INTO entries VALUES (?)', ["text with ' quotes --"]);
const result = await db.queryValues('SELECT value AS "2", value AS "1" FROM entries');
// result.values contains arrays in projection order, including duplicate names.
```

`queryValues` sends `rowMode: 'array'` to the native `query` method. Android reads cursor columns by ordinal; that also fixes qualified expression labels in existing object mode. An incompatible native result shape is rejected by the JavaScript wrapper. Values are strings, numbers, nulls or byte arrays, and empty BLOBs remain distinct from nulls.

`executeStatement` prepares and binds one statement without the legacy sync-table, soft-delete, comment or RETURNING transformations. It adds no transaction. Use `queryValues` for statements returning rows, including native `INSERT ... RETURNING`. Supply migration statements individually using the migration tool's own boundaries; do not split SQL scripts on semicolons.

Parameters are bound using AndroidX/SQLCipher on Android and `sqlite3_bind_*` on iOS. No manual escaping or parameter interpolation is introduced. Use trusted SQL with bound user values; this API does not make arbitrary user-supplied SQL safe. Android follows its native missing-binding behavior (unbound slots are null); iOS checks the prepared parameter count. Extra bindings reject. Drizzle produces matching placeholder/value lists. There is no custom placeholder parser to infer counts.

The caller must serialize complete transaction callbacks and other work sharing a connection. Await native close before releasing connection ownership. Prepared statements and cursors are released on failure. These APIs intentionally bypass the plugin's legacy synchronization rewriting; applications relying on those features should continue using their existing interfaces.

## Development and validation

From this repository, with Node 24:

```sh
npm ci --ignore-scripts
npm run build
npm test
```

The wrapper tests use Node's built-in test runner and the compiled package. Native tests live in Aurora's `apps/mobile/proofs/sqlite` and run against the built Android app. They cover ordered columns, actual shared Drizzle repositories, generated migrations/triggers, BLOBs, literal SQL, bound injection-like text, native RETURNING, rollback and process interruption. Wrapper mocks alone do not validate the native implementation.

This fork tracks `dist/` so consumers can install a commit-pinned GitHub source archive with built JavaScript and type declarations already present. This avoids install-time compilation and dependency lifecycle scripts. Regenerate `dist/` with `npm run build` whenever the TypeScript API changes and commit the output with its source. Android and iOS sources are included in the same archive. Aurora pins the complete commit hash in its manifest and locks the archive checksum.

For local native development, build this repository explicitly and use a temporary Yarn `portal:` override in Aurora. Before pushing Aurora, replace the override with the available full-commit archive URL, refresh its lockfile, and run `cap sync` so generated native paths reference the installed package. Do not commit local sibling paths. No upstream pull request or package-registry release has been created.
