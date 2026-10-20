import assert from "node:assert/strict";
import test from "node:test";
import { credentialRef } from "@hypit/hypit/endpoint";
import type {
  AsyncEndpoint,
  BlobRef,
  EndpointRegistrar,
  EndpointRequest,
} from "@hypit/hypit/endpoint";
import type { GenerationRequest } from "@hypit/generation";
import activation from "./activation.js";
import {
  capability,
  createMiniMaxH3Provider,
} from "./provider.js";
import type { MiniMaxH3ProviderOptions } from "./provider.js";

type StartContext = Parameters<AsyncEndpoint["start"]>[0];
type FetchCall = {
  readonly url: string;
  readonly init?: RequestInit;
};
type Support = {
  readonly status: string;
  readonly reason?: string;
};

const API_BASE = "https://h3.example.test/api/v1/open";
const API_KEY = "test-secret-key";
const IMAGE_URL = "https://h3.example.test/media/reference-image.png";
const AUDIO_URL = "https://h3.example.test/media/reference-audio.mp3";
const VIDEO_URL = "https://h3.example.test/media/result.mp4?signature=signed-value";
const RESULT_CDN_URL = "https://res.example.test/artifacts/result.mp4?signature=signed-value";

function image(resource: string, size = 4, mediaType = "image/png"): BlobRef {
  return {
    kind: "blob",
    resource: resource as BlobRef["resource"],
    size,
    mediaType,
  };
}

function video(resource: string): BlobRef {
  return {
    kind: "blob",
    resource: resource as BlobRef["resource"],
    size: 4,
    mediaType: "video/mp4",
  };
}

function audio(resource: string, size = 4, mediaType = "audio/mpeg"): BlobRef {
  return {
    kind: "blob",
    resource: resource as BlobRef["resource"],
    size,
    mediaType,
  };
}

function request(ports: GenerationRequest["ports"]): GenerationRequest {
  return { ports };
}

function need(value: GenerationRequest): EndpointRequest {
  return {
    capability,
    returns: { module: { name: "@hypit/generation", version: "1" }, name: "video-set" },
    constraints: value as never,
  };
}

function media(
  resource: string,
  role: "image" | "video" | "audio",
  artifact: BlobRef,
): { readonly role: "image" | "video" | "audio"; readonly artifact: BlobRef } {
  return { role, artifact };
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function install(
  fetch: typeof globalThis.fetch,
  overrides: Partial<MiniMaxH3ProviderOptions> = {},
) {
  let endpoint: AsyncEndpoint | undefined;
  let supports: ((request: EndpointRequest) => unknown) | undefined;
  const registrar: EndpointRegistrar = {
    registerImmediateEndpoint() {
      throw new Error("unexpected immediate endpoint");
    },
    registerAsyncEndpoint(_id, _capability, _returns, value, options) {
      endpoint = value;
      supports = options?.supports;
    },
  };
  const instance = createMiniMaxH3Provider({
    instance: "minimax-h3.selfhosted",
    pool: "minimax-h3.selfhosted",
    baseUrl: API_BASE,
    apiKey: credentialRef("local", "minimax-h3.selfhosted"),
    fetch,
    ...overrides,
  });
  return {
    async install() {
      await instance.install(registrar);
      assert(endpoint !== undefined);
      return { endpoint, supports };
    },
  };
}

function context(
  value: GenerationRequest,
  resources: Map<string, Uint8Array>,
  checkpoint?: (value: unknown) => void,
): StartContext {
  return {
    command: {
      kind: "fulfill-need",
      id: "command-1",
      need: {
        id: "need-1",
        capability,
        returns: need(value).returns,
        constraints: value as never,
        result: "result-1",
      },
    },
    need: {
      id: "need-1",
      capability,
      returns: need(value).returns,
      constraints: value as never,
      result: "result-1",
    },
    resources: {
      async get(resource) {
        return resources.get(resource);
      },
      async put(bytes, mediaType) {
        return {
          kind: "blob",
          resource: "res_output" as BlobRef["resource"],
          size: bytes.byteLength,
          mediaType,
        };
      },
      async has(resource) {
        return resources.has(resource);
      },
      async write() {},
    },
    credentials: { apiKey: { secret: API_KEY } },
    operation: "operation-1",
    async checkpoint(value) {
      checkpoint?.(value);
    },
    async reportProgress() {},
  };
}

async function supportFor(
  ports: GenerationRequest["ports"],
  overrides: Partial<MiniMaxH3ProviderOptions> = {},
): Promise<Support> {
  const fakeFetch: typeof globalThis.fetch = async () => {
    throw new Error("support checks must not call the service");
  };
  const { install: open } = install(fakeFetch, overrides);
  const { supports } = await open();
  assert(supports !== undefined);
  return supports(need(request(ports))) as Support;
}

test("uploads references, preserves projectId, and submits Open V2 content", async () => {
  const calls: FetchCall[] = [];
  let uploads = 0;
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    if (url.includes("/v1/assets?")) {
      uploads += 1;
      return uploads === 1
        ? json({ asset: { url: IMAGE_URL } })
        : json({ assets: [{ id: "ast_audio", url: AUDIO_URL }] });
    }
    if (url.endsWith("/v2/video_generation")) return json({ task_id: "task-upload" });
    throw new Error(`unexpected URL ${url}`);
  };
  const { install: open } = install(fakeFetch, { projectId: "project A/slash" });
  const { endpoint } = await open();
  const resources = new Map<string, Uint8Array>([
    ["res_img", new Uint8Array([1, 2, 3, 4])],
    ["res_audio", new Uint8Array([5, 6, 7, 8])],
  ]);
  let checkpoint: unknown;
  const value = request({
    prompt: ["a paper boat crossing a table"],
    duration: [5],
    resolution: ["768P"],
    aspectRatio: ["9:16"],
    referenceImage: [media("res_img", "image", image("res_img"))],
    referenceAudio: [media("res_audio", "audio", audio("res_audio"))],
  });
  const result = await endpoint.start(context(value, resources, (item) => {
    checkpoint = item;
  }));

  assert.equal(result.status, "pending");
  assert.deepEqual(checkpoint, {
    handle: { id: "task-upload" },
    receipt: { id: "task-upload" },
  });
  assert.equal(calls.length, 3);

  for (const call of calls.slice(0, 2)) {
    assert.equal(
      call.url,
      `${API_BASE}/v1/assets?projectId=project%20A%2Fslash`,
    );
    assert.equal(call.init?.method, "POST");
    assert.equal(
      new Headers(call.init?.headers).get("authorization"),
      `Bearer ${API_KEY}`,
    );
    assert.ok(call.init?.body instanceof FormData);
    const uploaded = (call.init.body as FormData).get("files");
    assert.ok(uploaded instanceof Blob);
    assert.ok(
      uploaded.type === "image/png" || uploaded.type === "audio/mpeg",
    );
  }

  const submitted = calls[2];
  assert(submitted !== undefined);
  assert.equal(submitted.url, `${API_BASE}/v2/video_generation`);
  assert.equal(
    new Headers(submitted.init?.headers).get("authorization"),
    `Bearer ${API_KEY}`,
  );
  const body = JSON.parse(String(submitted.init?.body)) as Record<string, any>;
  assert.equal(body.model, "MiniMax-H3");
  assert.equal(body.duration, 5);
  assert.equal(body.resolution, "768P");
  assert.equal(body.ratio, "9:16");
  assert.equal(body.projectId, "project A/slash");
  assert.match(body.idempotencyKey, /^hypit-h3-[a-f0-9]{64}$/u);
  assert.ok(body.idempotencyKey.length <= 180);
  assert.deepEqual(body.content, [
    { type: "text", text: "a paper boat crossing a table" },
    {
      role: "reference_image",
      type: "image_url",
      image_url: { url: IMAGE_URL },
    },
    {
      role: "reference_audio",
      type: "audio_url",
      audio_url: { url: AUDIO_URL },
    },
  ]);
});

test("rejects a missing uploaded asset URL before submission", async () => {
  const calls: FetchCall[] = [];
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
    return json({
      asset: { id: "ast_missing_url" },
      requestId: "req-asset-body",
    });
  };
  const { install: open } = install(fakeFetch);
  const { endpoint } = await open();
  const value = request({
    prompt: ["missing asset URL"],
    duration: [5],
    resolution: ["768P"],
    referenceImage: [media("res_img", "image", image("res_img"))],
  });

  await assert.rejects(
    async () => await endpoint.start(
      context(value, new Map([["res_img", new Uint8Array([1, 2, 3, 4])]])),
    ),
    /MINIMAX_H3_ASSET_URL_MISSING: upload returned asset IDs but no media URL; request=req-asset-body/u,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls.some((call) => call.url.endsWith("/v2/video_generation")), false);
});

test("rejects uploaded assets outside the deployment origin or media path", async () => {
  for (const [assetUrl, expected] of [
    ["https://other.example/media/image.png", /must belong to the configured deployment/u],
    ["https://h3.example.test/uploads/image.png", /must use the deployment's \/media\/ path/u],
  ] as const) {
    const fakeFetch: typeof globalThis.fetch = async () => json({
      asset: { url: assetUrl },
    });
    const { install: open } = install(fakeFetch);
    const { endpoint } = await open();
    const value = request({
      prompt: ["untrusted asset"],
      duration: [5],
      resolution: ["768P"],
      referenceImage: [media("res_img", "image", image("res_img"))],
    });
    await assert.rejects(
      async () => await endpoint.start(
        context(value, new Map([["res_img", new Uint8Array([1, 2, 3, 4])]])),
      ),
      expected,
    );
  }
});

test("enforces model-specific duration, resolution, and aspect ratio limits", async () => {
  for (const model of ["MiniMax-H3", "MiniMax-H3-Max"] as const) {
    const limits = model === "MiniMax-H3"
      ? { minimum: 4, maximum: 15, valid: "768P", invalid: "480P" }
      : { minimum: 5, maximum: 15, valid: "480P", invalid: "2K" };

    assert.equal((await supportFor({
      prompt: ["duration"],
      duration: [limits.minimum],
      resolution: [limits.valid],
      aspectRatio: ["9:16"],
    }, { model })).status, "supported");
    assert.equal((await supportFor({
      prompt: ["duration"],
      duration: [limits.maximum],
      resolution: [limits.valid],
      aspectRatio: ["16:9"],
    }, { model })).status, "supported");

    const tooShort = await supportFor({
      prompt: ["duration"],
      duration: [limits.minimum - 1],
      resolution: [limits.valid],
    }, { model });
    assert.equal(tooShort.status, "unsupported");
    assert.match(tooShort.reason ?? "", new RegExp(`${limits.minimum}-${limits.maximum}`, "u"));

    const tooLong = await supportFor({
      prompt: ["duration"],
      duration: [limits.maximum + 1],
      resolution: [limits.valid],
    }, { model });
    assert.equal(tooLong.status, "unsupported");

    const badResolution = await supportFor({
      prompt: ["resolution"],
      duration: [limits.minimum],
      resolution: [limits.invalid],
    }, { model });
    assert.equal(badResolution.status, "unsupported");

    const missingResolution = await supportFor({
      prompt: ["missing resolution"],
      duration: [limits.minimum],
    }, { model });
    assert.equal(missingResolution.status, "unsupported");
    assert.match(missingResolution.reason ?? "", /requires exactly one resolution/u);
  }

  for (const aspectRatio of ["4:5", "1:1", "21:9"]) {
    const support = await supportFor({
      prompt: ["ratio"],
      duration: [5],
      resolution: ["768P"],
      aspectRatio: [aspectRatio],
    });
    assert.equal(support.status, "unsupported");
    assert.match(support.reason ?? "", /9:16 or 16:9/u);
  }

  for (const ports of [
    { prompt: ["two durations"], duration: [5, 6], resolution: ["768P"] },
    { prompt: ["two resolutions"], duration: [5], resolution: ["768P", "2K"] },
    { prompt: ["two ratios"], duration: [5], resolution: ["768P"], aspectRatio: ["9:16", "16:9"] },
  ] as GenerationRequest["ports"][]) {
    assert.equal((await supportFor(ports)).status, "unsupported");
  }
});

test("enforces prompt, reference-count, MIME, and content-item limits", async () => {
  assert.equal((await supportFor({
    prompt: ["x".repeat(7_000)],
    duration: [5],
    resolution: ["768P"],
  })).status, "supported");
  assert.equal((await supportFor({
    prompt: ["x".repeat(7_001)],
    duration: [5],
    resolution: ["768P"],
  })).status, "unsupported");
  assert.equal((await supportFor({
    prompt: ["   "],
    duration: [5],
    resolution: ["768P"],
  })).status, "unsupported");

  const sixImages = Array.from({ length: 6 }, (_, index) =>
    media(`res_img_${index}`, "image", image(`res_img_${index}`)));
  const threeAudio = Array.from({ length: 3 }, (_, index) =>
    media(`res_audio_${index}`, "audio", audio(`res_audio_${index}`)));
  assert.equal((await supportFor({
    prompt: ["maximum references"],
    duration: [5],
    resolution: ["768P"],
    referenceImage: sixImages,
    referenceAudio: threeAudio,
  })).status, "supported");

  const sevenImages = await supportFor({
    prompt: ["too many images"],
    duration: [5],
    resolution: ["768P"],
    referenceImage: [
      ...sixImages,
      media("res_img_7", "image", image("res_img_7")),
    ],
  });
  assert.equal(sevenImages.status, "unsupported");
  assert.match(sevenImages.reason ?? "", /at most 6 image references/u);

  const fourAudio = await supportFor({
    prompt: ["too many audio references"],
    duration: [5],
    resolution: ["768P"],
    referenceImage: [sixImages[0]!],
    referenceAudio: [
      ...threeAudio,
      media("res_audio_4", "audio", audio("res_audio_4")),
    ],
  });
  assert.equal(fourAudio.status, "unsupported");
  assert.match(fourAudio.reason ?? "", /at most 3 audio references/u);

  const wrongMime = await supportFor({
    prompt: ["wrong mime"],
    duration: [5],
    resolution: ["768P"],
    referenceImage: [media("res_video", "image", video("res_video"))],
  });
  assert.equal(wrongMime.status, "unsupported");
  assert.match(wrongMime.reason ?? "", /image MIME type/u);

  for (const ports of [
    {
      prompt: ["unsupported image subtype"],
      duration: [5],
      resolution: ["768P"],
      referenceImage: [media("res_svg", "image", image("res_svg", 4, "image/svg+xml"))],
    },
    {
      prompt: ["unsupported audio subtype"],
      duration: [5],
      resolution: ["768P"],
      referenceImage: [sixImages[0]!],
      referenceAudio: [media("res_webm", "audio", audio("res_webm", 4, "audio/webm"))],
    },
  ] as GenerationRequest["ports"][]) {
    assert.equal((await supportFor(ports)).status, "unsupported");
  }
});

test("requires an image when reference audio is supplied", async () => {
  const support = await supportFor({
    prompt: ["audio without image"],
    duration: [5],
    resolution: ["768P"],
    referenceAudio: [media("res_audio", "audio", audio("res_audio"))],
  });
  assert.equal(support.status, "unsupported");
  assert.match(support.reason ?? "", /requires at least one reference image/u);
});

test("explicitly rejects unsupported reference and frame ports", async () => {
  const cases: GenerationRequest["ports"][] = [
    {
      prompt: ["reference video"],
      duration: [5],
      referenceVideo: [media("res_video", "video", video("res_video"))],
    } as GenerationRequest["ports"],
    {
      prompt: ["first frame"],
      duration: [5],
      firstFrame: [media("res_img", "image", image("res_img"))],
    } as GenerationRequest["ports"],
    {
      prompt: ["last frame"],
      duration: [5],
      lastFrame: [media("res_img", "image", image("res_img"))],
    } as GenerationRequest["ports"],
    {
      prompt: ["unknown"],
      duration: [5],
      unknownPort: ["value"],
    } as unknown as GenerationRequest["ports"],
  ];
  for (const ports of cases) {
    const support = await supportFor(ports);
    assert.equal(support.status, "unsupported");
    assert.match(support.reason ?? "", /does not support port/u);
  }
});

test("rejects oversized media instead of truncating it", async () => {
  const fakeFetch: typeof globalThis.fetch = async () => {
    throw new Error("oversized media must not be uploaded");
  };
  const { install: open } = install(fakeFetch, { maxMediaBytes: 2 });
  const { endpoint } = await open();
  const value = request({
    prompt: ["too large"],
    duration: [5],
    resolution: ["768P"],
    referenceImage: [media("res_img", "image", image("res_img", 3))],
  });
  const support = (await open()).supports;
  assert(support !== undefined);
  const result = support(need(value)) as Support;
  assert.equal(result.status, "unsupported");
  assert.match(result.reason ?? "", /exceeds maxMediaBytes/u);
  await assert.rejects(
    async () => await endpoint.start(
      context(value, new Map([["res_img", new Uint8Array([1, 2, 3])]])),
    ),
    /exceeds maxMediaBytes/u,
  );
});

test("polls queued and running tasks, unwraps body.task, then downloads without credentials", async () => {
  const calls: FetchCall[] = [];
  let polls = 0;
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    if (url.endsWith("/v2/video_generation")) {
      return json({ task_id: "task-live" });
    }
    if (url.endsWith("/v2/query/video_generation/task-live")) {
      polls += 1;
      if (polls === 1) {
        return json({ task: { id: "task-live", status: "queued" } });
      }
      if (polls === 2) {
        return json({ task: { id: "task-live", status: "running" } });
      }
      return json({
        task: {
          id: "task-live",
          status: "succeeded",
          content: { url: VIDEO_URL },
        },
      });
    }
    if (url === VIDEO_URL) {
      return new Response(new Uint8Array([9, 8, 7]), {
        headers: { "content-type": "video/mp4" },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const { install: open } = install(fakeFetch);
  const { endpoint } = await open();
  const value = request({ prompt: ["poll test"], duration: [4], resolution: ["768P"] });
  let checkpoint: unknown;
  const start = await endpoint.start(context(value, new Map(), (item) => {
    checkpoint = item;
  }));
  assert.equal(start.status, "pending");
  assert.deepEqual(checkpoint, {
    handle: { id: "task-live" },
    receipt: { id: "task-live" },
  });
  let handle = start.status === "pending" ? start.handle : undefined;
  assert(handle !== undefined);

  const queued = await endpoint.poll({ ...context(value, new Map()), handle });
  assert.equal(queued.status, "pending");
  handle = queued.status === "pending" ? queued.handle : undefined;
  assert(handle !== undefined);

  const running = await endpoint.poll({ ...context(value, new Map()), handle });
  assert.equal(running.status, "pending");
  handle = running.status === "pending" ? running.handle : undefined;
  assert(handle !== undefined);

  const ready = await endpoint.poll({ ...context(value, new Map()), handle });
  assert.equal(ready.status, "ready");
  assert.deepEqual(
    ready.status === "ready" ? ready.handle : undefined,
    { id: "task-live", url: VIDEO_URL },
  );
  handle = ready.status === "ready" ? ready.handle : undefined;
  assert(handle !== undefined);

  const completed = await endpoint.collect!({
    ...context(value, new Map()),
    handle,
  });
  assert.equal(completed.status, "completed");
  const query = calls.find((call) => call.url.includes("/v2/query/"));
  assert.equal(
    new Headers(query?.init?.headers).get("authorization"),
    `Bearer ${API_KEY}`,
  );
  const download = calls.at(-1);
  assert.equal(download?.url, VIDEO_URL);
  assert.equal(new Headers(download?.init?.headers).has("authorization"), false);
});

test("retries transient query transport failures without failing the task", async () => {
  let queries = 0;
  const fakeFetch: typeof globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v2/video_generation")) {
      return json({ task_id: "task-retry" });
    }
    if (url.endsWith("/v2/query/video_generation/task-retry")) {
      queries += 1;
      if (queries <= 2) throw new TypeError("fetch failed");
      return json({
        task: {
          id: "task-retry",
          status: "succeeded",
          content: { url: VIDEO_URL },
        },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const { install: open } = install(fakeFetch);
  const { endpoint } = await open();
  const value = request({ prompt: ["retry query"], duration: [4], resolution: ["768P"] });
  const start = await endpoint.start(context(value, new Map()));
  let handle = start.status === "pending" ? start.handle : undefined;
  assert(handle !== undefined);

  const firstRetry = await endpoint.poll({ ...context(value, new Map()), handle });
  assert.equal(firstRetry.status, "pending");
  handle = firstRetry.status === "pending" ? firstRetry.handle : undefined;
  assert.deepEqual(handle, { id: "task-retry", transportRetries: 1 });

  const secondRetry = await endpoint.poll({ ...context(value, new Map()), handle });
  assert.equal(secondRetry.status, "pending");
  handle = secondRetry.status === "pending" ? secondRetry.handle : undefined;
  assert.deepEqual(handle, { id: "task-retry", transportRetries: 2 });

  const ready = await endpoint.poll({ ...context(value, new Map()), handle });
  assert.equal(ready.status, "ready");
  assert.equal(queries, 3);
});

test("preserves a failed task code and task id while redacting secrets and URLs", async () => {
  const fakeFetch: typeof globalThis.fetch = async (input) => {
    if (String(input).endsWith("/v2/video_generation")) {
      return json({ task_id: "task-fail" });
    }
    return json({
      task: {
        id: "task-fail",
        status: "failed",
        error: {
          code: "BAD_INPUT",
          message: `upstream https://signed.example/file?token=abc rejected ${API_KEY}`,
        },
      },
    });
  };
  const { install: open } = install(fakeFetch);
  const { endpoint } = await open();
  const value = request({ prompt: ["failure"], duration: [4], resolution: ["768P"] });
  const start = await endpoint.start(context(value, new Map()));
  const handle = start.status === "pending" ? start.handle : undefined;
  assert(handle !== undefined);

  const result = await endpoint.poll({ ...context(value, new Map()), handle });
  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.receipt?.id : undefined, "task-fail");
  const failure = result.status === "failed" ? result.failure : undefined;
  assert.equal(failure?.code, "BAD_INPUT");
  assert.match(failure?.message ?? "", /\[redacted-url\]/u);
  assert.match(failure?.message ?? "", /\[redacted\]/u);
  assert.doesNotMatch(
    `${failure?.code} ${failure?.message}`,
    new RegExp(`${API_KEY}|signed\\.example|token=abc`, "u"),
  );
});

test("reports remote cancellation as a failed task with a stable code", async () => {
  const fakeFetch: typeof globalThis.fetch = async (input) => {
    if (String(input).endsWith("/v2/video_generation")) {
      return json({ task_id: "task-cancelled" });
    }
    return json({ task: { id: "task-cancelled", status: "cancelled" } });
  };
  const { install: open } = install(fakeFetch);
  const { endpoint } = await open();
  const value = request({ prompt: ["cancel"], duration: [4], resolution: ["768P"] });
  const start = await endpoint.start(context(value, new Map()));
  const handle = start.status === "pending" ? start.handle : undefined;
  assert(handle !== undefined);
  const result = await endpoint.poll({ ...context(value, new Map()), handle });
  assert.equal(result.status, "failed");
  assert.equal(
    result.status === "failed" ? result.failure.code : undefined,
    "MINIMAX_H3_CANCELLED",
  );
});

test("rejects a result URL outside the deployment instead of downloading it", async () => {
  const fakeFetch: typeof globalThis.fetch = async (input) => {
    if (String(input).endsWith("/v2/video_generation")) {
      return json({ task_id: "task-untrusted-result" });
    }
    return json({
      task: {
        id: "task-untrusted-result",
        status: "succeeded",
        content: { url: "https://cdn.example/video.mp4" },
      },
    });
  };
  const { install: open } = install(fakeFetch);
  const { endpoint } = await open();
  const value = request({
    prompt: ["untrusted result"],
    duration: [4],
    resolution: ["768P"],
  });
  const start = await endpoint.start(context(value, new Map()));
  const handle = start.status === "pending" ? start.handle : undefined;
  assert(handle !== undefined);
  await assert.rejects(
    async () => await endpoint.poll({ ...context(value, new Map()), handle }),
    /must belong to the configured deployment/u,
  );
});

test("downloads a result from an explicitly allowlisted HTTPS origin", async () => {
  const calls: FetchCall[] = [];
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    if (url.endsWith("/v2/video_generation")) {
      return json({ task_id: "task-cdn-result" });
    }
    if (url.endsWith("/v2/query/video_generation/task-cdn-result")) {
      return json({
        task: {
          id: "task-cdn-result",
          status: "succeeded",
          content: { url: RESULT_CDN_URL },
        },
      });
    }
    if (url === RESULT_CDN_URL) {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "content-type": "video/mp4" },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const { install: open } = install(fakeFetch, {
    resultOrigins: ["https://res.example.test"],
  });
  const { endpoint } = await open();
  const value = request({
    prompt: ["allowlisted result"],
    duration: [4],
    resolution: ["768P"],
  });
  const start = await endpoint.start(context(value, new Map()));
  const startHandle = start.status === "pending" ? start.handle : undefined;
  assert(startHandle !== undefined);
  const ready = await endpoint.poll({ ...context(value, new Map()), handle: startHandle });
  const handle = ready.status === "ready" ? ready.handle : undefined;
  assert(handle !== undefined);
  assert(handle !== null && typeof handle === "object" && !Array.isArray(handle));
  const resultHandle = handle as Readonly<Record<string, unknown>>;
  assert.equal(resultHandle.url, RESULT_CDN_URL);

  const completed = await endpoint.collect!({
    ...context(value, new Map()),
    handle,
  });
  assert.equal(completed.status, "completed");
  const download = calls.at(-1);
  assert.equal(download?.url, RESULT_CDN_URL);
  assert.equal(new Headers(download?.init?.headers).has("authorization"), false);
});

test("rejects result URLs outside a configured resultOrigins allowlist", async () => {
  const fakeFetch: typeof globalThis.fetch = async (input) => {
    if (String(input).endsWith("/v2/video_generation")) {
      return json({ task_id: "task-result-not-allowlisted" });
    }
    return json({
      task: {
        id: "task-result-not-allowlisted",
        status: "succeeded",
        content: { url: "https://other-cdn.example/video.mp4" },
      },
    });
  };
  const { install: open } = install(fakeFetch, {
    resultOrigins: ["https://res.example.test"],
  });
  const { endpoint } = await open();
  const value = request({
    prompt: ["result not allowlisted"],
    duration: [4],
    resolution: ["768P"],
  });
  const start = await endpoint.start(context(value, new Map()));
  const handle = start.status === "pending" ? start.handle : undefined;
  assert(handle !== undefined);
  await assert.rejects(
    async () => await endpoint.poll({ ...context(value, new Map()), handle }),
    /must belong to configured resultOrigins/u,
  );
});

test("rejects unsafe resultOrigins configuration", async () => {
  for (const resultOrigin of [
    "http://res.example.test",
    "https://user:password@res.example.test",
    "https://res.example.test/artifacts",
    "https://res.example.test?redirect=other",
    "https://res.example.test#fragment",
  ]) {
    assert.throws(
      () => install(async () => {
        throw new Error("configuration tests must not call the service");
      }, { resultOrigins: [resultOrigin] }),
      /requires HTTPS|must not contain credentials|must be an origin without/u,
      resultOrigin,
    );
  }
});

test("submits DELETE cancellation with credentials and maps late cancellation", async () => {
  const calls: FetchCall[] = [];
  let nextCancel: () => Response = () => new Response(null, { status: 204 });
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
    return nextCancel();
  };
  const { install: open } = install(fakeFetch);
  const { endpoint } = await open();
  assert(endpoint.cancel !== undefined);
  const value = request({ prompt: ["cancel"], duration: [4], resolution: ["768P"] });
  const handle = { id: "task-cancel" };

  const accepted = await endpoint.cancel({
    ...context(value, new Map()),
    handle,
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(
    calls[0]?.url,
    `${API_BASE}/v2/video_generation/task-cancel`,
  );
  assert.equal(calls[0]?.init?.method, "DELETE");
  assert.equal(
    new Headers(calls[0]?.init?.headers).get("authorization"),
    `Bearer ${API_KEY}`,
  );

  nextCancel = () => json({ action: "cancelled", status: "cancelled" });
  const acceptedJson = await endpoint.cancel({
    ...context(value, new Map()),
    handle,
  });
  assert.equal(acceptedJson.status, "accepted");

  for (const [code, statusCode] of [
    ["V2_TASK_ALREADY_CANCELLED", 400],
    ["V2_TASK_NOT_CANCELLABLE", 409],
    ["V2_TASK_REVIEW_PENDING", 422],
  ] as const) {
    nextCancel = () => json({
      error: { code, message: "cancellation state is already final" },
    }, statusCode);
    const tooLate = await endpoint.cancel({
      ...context(value, new Map()),
      handle,
    });
    assert.equal(tooLate.status, "too-late");
  }

  nextCancel = () => json({ status: "running" });
  await assert.rejects(
    async () => await endpoint.cancel?.({
      ...context(value, new Map()),
      handle,
    }),
    /unexpected status/u,
  );
});

test("redacts API failures and request ids", async () => {
  const fakeFetch: typeof globalThis.fetch = async () => json({
    error: {
      code: "RATE_LIMITED",
      message: `see https://billing.example/task using ${API_KEY}`,
    },
  }, 429, { "x-request-id": `request-${API_KEY}` });
  const { install: open } = install(fakeFetch);
  const { endpoint } = await open();
  const value = request({
    prompt: ["http failure"],
    duration: [4],
    resolution: ["768P"],
  });
  await assert.rejects(
    async () => await endpoint.start(context(value, new Map())),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /HTTP 429/u);
      assert.match(error.message, /RATE_LIMITED/u);
      assert.doesNotMatch(
        error.message,
        new RegExp(`${API_KEY}|billing\\.example`, "u"),
      );
      return true;
    },
  );
});

test("activation requires the Open V2 protocol and exact configuration", async () => {
  const facet = activation.facets[0];
  assert(facet !== undefined);
  const activate = (facet.implementation as {
    activate: (context: {
      instance: string;
      pool: string;
      config: never;
      hostStateRoot: string;
      dataRoot: string;
    }) => Promise<unknown>;
  }).activate;
  const base = {
    instance: "minimax-h3.selfhosted",
    pool: "minimax-h3.selfhosted",
    hostStateRoot: "/tmp/host",
    dataRoot: "/tmp/data",
  };
  await assert.rejects(
    async () => await activate({
      ...base,
      config: {
        protocol: "minimax-v2",
        baseUrl: API_BASE,
        apiKey: { store: "local", key: "mini" },
      } as never,
    }),
    /protocol must be "minimax-h3-open-v2"/u,
  );
  await assert.rejects(
    async () => await activate({
      ...base,
      config: {
        protocol: "minimax-h3-open-v2",
        baseUrl: API_BASE,
        apiKey: { store: "local", key: "mini" },
        unexpected: true,
      } as never,
    }),
    /does not accept unexpected/u,
  );
  await activate({
    ...base,
    config: {
      protocol: "minimax-h3-open-v2",
      baseUrl: API_BASE,
      model: "MiniMax-H3-Max",
      projectId: "project-1",
      apiKey: { store: "local", key: "mini" },
    } as never,
  });
});
