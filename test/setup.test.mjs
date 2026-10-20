import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CAPABILITY,
  DEFAULT_ENDPOINT,
  PACKAGE_NAME,
  configureRuntime,
} from "../bin/setup.mjs";

const setupPath = fileURLToPath(new URL("../bin/setup.mjs", import.meta.url));

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [setupPath, ...args], {
      cwd,
      env: { ...process.env, HYPIT_BIN: "/definitely/not/used" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("creates a complete Profile in an empty project", () => {
  const runtime = configureRuntime(undefined);
  assert.equal(runtime.format, "hypit.runtime-local@1");
  assert.equal(runtime.dataRoot, ".hypit/runtimes/local");
  assert.deepEqual(runtime.credentials.local, {
    use: "@hypit/credential-store-local",
  });
  assert.equal(runtime.endpoints[DEFAULT_ENDPOINT].use, PACKAGE_NAME);
  assert.equal(runtime.endpoints[DEFAULT_ENDPOINT].pool, DEFAULT_ENDPOINT);
  assert.deepEqual(runtime.endpoints[DEFAULT_ENDPOINT].config.apiKey, {
    store: "local",
    key: DEFAULT_ENDPOINT,
  });
  assert.equal(runtime.bindings[CAPABILITY], DEFAULT_ENDPOINT);
});

test("merges into an existing Profile without replacing unrelated services", () => {
  const existing = {
    format: "hypit.runtime-local@1",
    dataRoot: ".hypit/custom",
    credentials: {
      local: { use: "@hypit/credential-store-local" },
      env: { use: "@hypit/credential-store-env" },
    },
    endpoints: {
      "media.local": { use: "@hypit/media-local" },
      [DEFAULT_ENDPOINT]: {
        use: "@monkeybad/provider-minimax-h3",
        pool: "h3-shared-account",
        config: {
          protocol: "minimax-h3-open-v2",
          baseUrl: "https://h3.example.test/api/v1/open",
          model: "MiniMax-H3-Max",
          apiKey: { store: "env", key: "H3_KEY" },
          resultOrigins: ["https://results.example.test"],
          pollIntervalMs: 7500,
        },
      },
      "image.personal": {
        use: "@example/provider-images",
        config: { baseUrl: "https://images.example.test", apiKey: { store: "env", key: "IMAGE_KEY" } },
      },
    },
    bindings: {
      "@example/image@1#image": "image.personal",
    },
  };
  const runtime = configureRuntime(existing);
  assert.equal(runtime.dataRoot, ".hypit/custom");
  assert.deepEqual(runtime.credentials.env, { use: "@hypit/credential-store-env" });
  assert.deepEqual(runtime.endpoints["media.local"], { use: "@hypit/media-local" });
  assert.deepEqual(runtime.endpoints["image.personal"], existing.endpoints["image.personal"]);
  assert.equal(runtime.endpoints[DEFAULT_ENDPOINT].pool, "h3-shared-account");
  assert.equal(
    runtime.endpoints[DEFAULT_ENDPOINT].config.baseUrl,
    "https://h3.example.test/api/v1/open",
  );
  assert.equal(runtime.endpoints[DEFAULT_ENDPOINT].config.model, "MiniMax-H3-Max");
  assert.deepEqual(
    runtime.endpoints[DEFAULT_ENDPOINT].config.resultOrigins,
    ["https://results.example.test"],
  );
  assert.equal(runtime.endpoints[DEFAULT_ENDPOINT].config.pollIntervalMs, 7_500);
  assert.deepEqual(runtime.endpoints[DEFAULT_ENDPOINT].config.apiKey, {
    store: "local",
    key: DEFAULT_ENDPOINT,
  });
  assert.equal(runtime.bindings["@example/image@1#image"], "image.personal");
  assert.equal(runtime.bindings[CAPABILITY], DEFAULT_ENDPOINT);
  assert.deepEqual(existing.endpoints[DEFAULT_ENDPOINT].config.apiKey, {
    store: "env",
    key: "H3_KEY",
  });
});

test("the installed setup command writes a Profile and never echoes a secret", async () => {
  const project = await mkdtemp(join(tmpdir(), "hypit-h3-setup-"));
  const secret = "must-not-appear-in-output";
  await writeFile(join(project, "private-note.txt"), secret);
  const result = await run(["--project", project, "--no-login"], project);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret, "u"));
  const runtime = JSON.parse(await readFile(join(project, "hypit.runtime.json"), "utf8"));
  assert.equal(runtime.endpoints[DEFAULT_ENDPOINT].config.protocol, "minimax-h3-open-v2");
  assert.equal(await readFile(join(project, ".hypit/runtime"), "utf8"), "hypit.runtime.json\n");
  assert.doesNotMatch(JSON.stringify(runtime), new RegExp(secret, "u"));
});
