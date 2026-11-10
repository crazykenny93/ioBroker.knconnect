"use strict";

const { spawnSync } = require("node:child_process");

// Let ts-node compile the tests; native type stripping bypasses its CommonJS loader.
const nodeOptions = process.allowedNodeEnvironmentFlags.has("--experimental-strip-types")
    ? ["--no-experimental-strip-types"]
    : [];
const result = spawnSync(process.execPath, [
    ...nodeOptions,
    require.resolve("mocha/bin/mocha.js"),
    "--config", "test/mocharc.custom.json",
    "src/**/*.test.ts",
    ...process.argv.slice(2),
], { stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
