#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "@monkeybad/provider-minimax-h3";
export const CAPABILITY = "@hypit/minimax-h3@1#minimax-h3";
export const DEFAULT_ENDPOINT = "minimax-h3.selfhosted";
export const DEFAULT_BASE_URL = "https://app.getcheapvideo.com/api/v1/open";
export const DEFAULT_RESULT_ORIGIN = "https://res.getcheapvideo.com";
export const DEFAULT_MODEL = "MiniMax-H3";

const RUNTIME_FORMAT = "hypit.runtime-local@1";
const LOCAL_STORE = "@hypit/credential-store-local";

function plainObject(value, subject) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${subject} must be a JSON object`);
  }
  return value;
}

function nonEmpty(value, subject) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${subject} must be a non-empty string`);
  }
  return value;
}

function httpsOrigin(value, subject) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${subject} is not a valid URL`);
  }
  if (url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== "") {
    throw new Error(`${subject} must be an HTTPS origin without credentials, path, query or fragment`);
  }
  return url.origin;
}

function mergeObject(parent, key, subject) {
  const existing = parent[key];
  if (existing === undefined) {
    const value = {};
    parent[key] = value;
    return value;
  }
  return plainObject(existing, subject);
}

function clone(value) {
  return structuredClone(value);
}

export function configureRuntime(existing, options = {}) {
  const source = existing === undefined || existing === null
    ? {}
    : plainObject(clone(existing), "hypit.runtime.json");
  const endpointName = nonEmpty(options.endpoint ?? DEFAULT_ENDPOINT, "endpoint");
  const baseUrl = nonEmpty(options.baseUrl ?? DEFAULT_BASE_URL, "baseUrl");
  const model = nonEmpty(options.model ?? DEFAULT_MODEL, "model");
  const resultOrigins = (options.resultOrigins ?? [DEFAULT_RESULT_ORIGIN])
    .map((value, index) => httpsOrigin(value, `resultOrigins[${index}]`));

  if (source.format !== undefined && source.format !== RUNTIME_FORMAT) {
    throw new Error(`hypit.runtime.json format must be ${RUNTIME_FORMAT}`);
  }
  source.format ??= RUNTIME_FORMAT;
  source.dataRoot ??= ".hypit/runtimes/local";

  const credentials = mergeObject(source, "credentials", "credentials");
  const localStore = mergeObject(credentials, "local", "credentials.local");
  localStore.use ??= LOCAL_STORE;

  const endpoints = mergeObject(source, "endpoints", "endpoints");
  const endpoint = mergeObject(endpoints, endpointName, `endpoints.${endpointName}`);
  endpoint.use = PACKAGE_NAME;
  endpoint.pool ??= endpointName;
  const config = mergeObject(endpoint, "config", `endpoints.${endpointName}.config`);
  config.protocol = "minimax-h3-open-v2";
  if (options.baseUrl !== undefined || config.baseUrl === undefined) config.baseUrl = baseUrl;
  if (options.model !== undefined || config.model === undefined) config.model = model;
  config.apiKey = { store: "local", key: endpointName };
  if (options.resultOrigins !== undefined || config.resultOrigins === undefined) {
    config.resultOrigins = resultOrigins;
  }
  config.concurrency ??= 1;
  config.pollIntervalMs ??= 5_000;
  config.maxMediaBytes ??= 100 * 1024 * 1024;

  const bindings = mergeObject(source, "bindings", "bindings");
  bindings[CAPABILITY] = endpointName;
  return source;
}

function usage() {
  return `Usage: hypit-provider-minimax-h3-setup [options]

Merge the MiniMax H3 Provider into a Hypit Runtime Profile, then securely
prompt for its API key through Hypit.

Options:
  --project <dir>          Hypit project directory (default: current directory)
  --runtime <file>         Runtime Profile path, relative to the project
  --endpoint <name>        Endpoint name (default: ${DEFAULT_ENDPOINT})
  --base-url <url>         Open V2 API base URL (default: ${DEFAULT_BASE_URL})
  --result-origin <origin> Allowed result HTTPS origin; repeat for multiple
  --model <name>           MiniMax-H3 or MiniMax-H3-Max
  --no-login               Configure only; print the secure login command
  --help                   Show this help

The script never accepts an API key as an argument, environment variable or
file. It starts "hypit auth login <endpoint>", which owns secure secret input.`;
}

function parseArgs(argv) {
  const options = {
    projectDir: process.cwd(),
    endpoint: DEFAULT_ENDPOINT,
    login: true,
  };
  const resultOrigins = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--no-login") {
      options.login = false;
      continue;
    }
    if (argument === "--project"
      || argument === "--runtime"
      || argument === "--endpoint"
      || argument === "--base-url"
      || argument === "--result-origin"
      || argument === "--model") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--project") options.projectDir = resolve(value);
      if (argument === "--runtime") options.runtime = value;
      if (argument === "--endpoint") options.endpoint = value;
      if (argument === "--base-url") options.baseUrl = value;
      if (argument === "--result-origin") resultOrigins.push(value);
      if (argument === "--model") options.model = value;
      continue;
    }
    throw new Error(`unknown option: ${argument}`);
  }
  if (resultOrigins.length > 0) options.resultOrigins = resultOrigins;
  return options;
}

async function selectedRuntime(projectDir, explicitRuntime) {
  if (explicitRuntime !== undefined) {
    return { path: resolve(projectDir, explicitRuntime), selectedByFile: false };
  }
  try {
    const selected = (await readFile(resolve(projectDir, ".hypit/runtime"), "utf8")).trim();
    if (selected.length > 0) {
      return { path: resolve(projectDir, selected), selectedByFile: true };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { path: resolve(projectDir, "hypit.runtime.json"), selectedByFile: false };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) {
      throw new Error(`${path} is not valid JSON`);
    }
    throw error;
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  let mode = 0o644;
  try {
    mode = (await stat(path)).mode & 0o777;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
    await chmod(temporary, mode);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function child(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const process = spawn(command, args, options);
    process.on("error", reject);
    process.on("exit", (code, signal) => resolvePromise({ code, signal }));
  });
}

async function runHypit(args, projectDir, stdio) {
  const executable = process.env.HYPIT_BIN ?? "hypit";
  return await child(executable, args, { cwd: projectDir, stdio });
}

async function credentialConfigured(endpoint, projectDir) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const executable = process.env.HYPIT_BIN ?? "hypit";
  const result = await child(executable, ["auth", "status", endpoint], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
  }).catch(() => ({ code: 1 }));
  return result.code === 0;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const projectDir = resolve(options.projectDir);
  const runtime = await selectedRuntime(projectDir, options.runtime);
  const relativeRuntime = relative(projectDir, runtime.path);
  if (relativeRuntime.startsWith(`..${sep}`) || relativeRuntime === "..") {
    throw new Error("Runtime Profile must be inside the Hypit project directory");
  }
  const configured = configureRuntime(await readJson(runtime.path), options);
  await atomicJson(runtime.path, configured);
  if (!runtime.selectedByFile) {
    await mkdir(resolve(projectDir, ".hypit"), { recursive: true });
    await writeFile(resolve(projectDir, ".hypit/runtime"), `${relativeRuntime}\n`);
  }

  process.stdout.write(`Configured ${options.endpoint} in ${runtime.path}\n`);
  process.stdout.write("API key reference: local credential store; no secret was read or written by setup.\n");

  if (!options.login) {
    process.stdout.write(`Next: hypit auth login ${options.endpoint}\n`);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`Non-interactive terminal. Next: hypit auth login ${options.endpoint}\n`);
    return;
  }
  if (await credentialConfigured(options.endpoint, projectDir)) {
    process.stdout.write(`Credential already configured for ${options.endpoint}; login not repeated.\n`);
    return;
  }

  process.stdout.write(`Starting secure credential input for ${options.endpoint}...\n`);
  const result = await runHypit(["auth", "login", options.endpoint], projectDir, "inherit");
  if (result.code === 0) {
    process.stdout.write(`Credential configured for ${options.endpoint}.\n`);
    return;
  }
  const reason = result.signal === null ? `exit code ${String(result.code)}` : `signal ${result.signal}`;
  throw new Error(`hypit auth login did not complete (${reason})`);
}

const invokedPath = process.argv[1] === undefined ? undefined : realpathSync(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
