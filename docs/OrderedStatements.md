# Ordered rows and unchanged single statements

This fork adds a narrow native API for ORM drivers. Existing `query`, `execute` and `run` signatures remain available. Android is validated by Aurora's emulator proof. iOS passes Aurora's actual Capacitor/WKWebView simulator proof, including shared Drizzle repositories and process-termination recovery; physical-device validation remains pending. Web and Electron reject the new operations explicitly.

```ts
// db is an open SQLiteDBConnection; the caller owns its lifetime.
await db.executeStatement('CREATE TABLE entries (value TEXT)');
await db.executeStatement('INSERT INTO entries VALUES (?)', ["text with ' quotes --"]);
const result = await db.queryValues('SELECT value AS "2", value AS "1" FROM entries');
// result.values contains arrays in projection order, including duplicate names.
```

`queryValues` sends `rowMode: 'array'` to the native `query` method. Android reads cursor columns by ordinal; that also fixes qualified expression labels in existing object mode. An incompatible native result shape is rejected by the JavaScript wrapper. Values are strings, numbers, nulls or byte arrays, and empty BLOBs remain distinct from nulls.

`executeStatement` prepares and binds one statement without the legacy sync-table, soft-delete, comment or RETURNING transformations. It adds no transaction. Use `queryValues` for statements returning rows, including native `INSERT ... RETURNING`. Supply migration statements individually using the migration tool's own boundaries; do not split SQL scripts on semicolons.

Parameters are bound using AndroidX/SQLCipher on Android and `sqlite3_bind_*` on iOS. No manual escaping or parameter interpolation is introduced. Use trusted SQL with bound user values; this API does not make arbitrary user-supplied SQL safe. Android follows its native missing-binding behavior (unbound slots are null); iOS checks the prepared parameter count. Extra bindings reject. On iOS, the new APIs also reject NUL in SQL and trailing statements before stepping the first statement. SQLite parses the tail with a temporary deny authorizer, preventing even prepare-time PRAGMA effects; trailing comments are allowed. No SQL tokenizer or regular-expression parser is used.

The iOS ordered path rejects integer inputs/results outside JavaScript's safe integer range rather than silently clamping or rounding them. Buffer-shaped parameters require numeric integer bytes from 0 through 255 (not booleans). The same decoder now supports Buffer-shaped values in legacy `run`; empty BLOB binding and object-mode reads preserve empty BLOB versus null. Other legacy SQL rewriting remains unchanged.

Drizzle produces matching placeholder/value lists. There is no custom placeholder parser to infer counts.

The caller must serialize complete transaction callbacks and other work sharing a connection. Await native close before releasing connection ownership. Prepared statements and cursors are released on failure. These APIs intentionally bypass the plugin's legacy synchronization rewriting; applications relying on those features should continue using their existing interfaces.

## Development and validation

From this repository, with Node 24:

```sh
npm ci --ignore-scripts
npm run build
npm test
```

The wrapper tests use Node's built-in test runner and the compiled package. Native tests live in Aurora's `apps/mobile/proofs/sqlite` and run against the built Android or iOS app. They cover ordered columns, actual shared Drizzle repositories, generated migrations/triggers, BLOBs, literal SQL, bound injection-like text, native RETURNING, rollback and process interruption. Wrapper mocks alone do not validate the native implementation.

This fork tracks `dist/` so consumers can install a commit-pinned GitHub source archive with built JavaScript and type declarations already present. This avoids install-time compilation and dependency lifecycle scripts. Regenerate `dist/` with `npm run build` whenever the TypeScript API changes and commit the output with its source. Android and iOS sources are included in the same archive. Aurora pins the complete commit hash in its manifest and locks the archive checksum.

For local native development, build this repository explicitly and use a temporary Yarn `portal:` override in Aurora. Before pushing Aurora, replace the override with the available full-commit archive URL, refresh its lockfile, and run `cap sync` so generated native paths reference the installed package. Do not commit local sibling paths. No upstream pull request or package-registry release has been created.

## iOS qualification (16 September 2026)

Aurora's `yarn probe:ios:sqlite <simulator-UDID>` builds the generated Capacitor SwiftPM app, injects the test payload into its real WKWebView with an opt-in simulator-only Swift harness, and invokes this plugin through Capacitor. It does not use mocks, a web SQLite implementation or an added automation dependency. The ordinary app bundle contains neither the payload nor the enabled harness. See [Aurora's iOS proof](https://github.com/pattersonjack/aurora/blob/drizzle-compatibility/docs/ios-sqlite-proof.md) for reproduction, per-case results and remaining gates.

Tested: Apple M2, macOS 27.0, Xcode 27.0 (27A266a), Swift 6.4, Node 24.21.0, Capacitor 8.5.2, iPhone 18 Pro simulator / iOS 27.0 (24A434), SQLCipher 4.19.0 community / SQLite 3.53.4. The initial implementation compiled but passed only 21/22 original checks because legacy `run` could not decode Buffer-shaped JSON. Extended tests reproduced permissive boolean-byte conversion and silent trailing-SQL acceptance; NSNumber also clamps out-of-range integers during conversion. The Swift fixes now pass all 32 checks, including actual journal methods, every byte, UTF-8 with embedded NUL, statement-error cleanup, safe integer limits, bind rejection, RETURNING, transaction/savepoint rollback and process termination. The process is terminated with an open transaction, relaunched, checked for committed-only data and integrity, and the disposable database is deleted through the plugin.

Native Android regressions were not rerun on this Mac. These changes touch only Swift; Android's raw missing-binding and statement-tail semantics have not been changed. Aurora's adapter continues to validate numbers on both platforms. Whole-callback transaction ownership, workload/durability qualification and physical-device tests remain separate gates. This is process-termination recovery evidence, not power-loss durability testing.

Deletion qualification also checks the main file and its `-wal`, `-shm` and `-journal` companions from the simulator host. The encryption-state check opens a read-only connection, which can recreate WAL/SHM after the writer closes; previously deletion removed only the main file. iOS deletion now removes those exact companions, supports retry when only sidecars remain, and rejects deletion while the plugin has a live independent reader. All connections to a database must be closed/owned by the caller before deletion, including connections outside this plugin. The test runner never deletes database files itself.
