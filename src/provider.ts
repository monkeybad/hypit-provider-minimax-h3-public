import { canonicalize, defineEndpoint, wakeAfter } from "@hypit/hypit/endpoint";
import type {
  AsyncEndpoint,
  CanonicalValue,
  CredentialRef,
  EndpointCancelOutcome,
  EndpointRequest,
  EndpointSupport,
} from "@hypit/hypit/endpoint";
import {
  generationTypes,
  sealGeneratedVideoSet,
} from "@hypit/generation";
import { createHash } from "node:crypto";
import type {
  GenerationMediaRole,
  GenerationMediaValue,
  GenerationRequest,
} from "@hypit/generation";

export const providerModule = { name: "@monkeybad/provider-minimax-h3", version: "1" } as const;
export const capability = {
  module: { name: "@hypit/minimax-h3", version: "1" },
  name: "minimax-h3",
} as const;

const KNOWN_PORTS = new Set([
  "prompt",
  "duration",
  "resolution",
  "aspectRatio",
  "referenceImage",
  "referenceAudio",
]);

const MEDIA_PORTS = {
  referenceImage: { role: "reference_image", media: "image", type: "image_url", key: "image_url" },
  referenceAudio: { role: "reference_audio", media: "audio", type: "audio_url", key: "audio_url" },
} as const;

const MODEL_LIMITS = {
  "MiniMax-H3": {
    resolutions: ["768P", "2K"],
    minimumDuration: 4,
    maximumDuration: 15,
  },
  "MiniMax-H3-Max": {
    resolutions: ["480P", "768P"],
    minimumDuration: 5,
    maximumDuration: 15,
  },
} as const;

const MAX_PROMPT_CHARS = 7_000;
const MAX_REFERENCE_IMAGES = 6;
const MAX_REFERENCE_AUDIO = 3;
const MAX_CONTENT_ITEMS = 64;
const ALLOWED_ASPECT_RATIOS = new Set(["9:16", "16:9"]);
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
]);
const CANCELLATION_TOO_LATE_CODES = new Set([
  "V2_TASK_NOT_CANCELLABLE",
  "V2_TASK_ALREADY_CANCELLED",
  "V2_TASK_REVIEW_PENDING",
]);
const MAX_POLL_TRANSPORT_RETRIES = 3;

type MiniMaxModel = keyof typeof MODEL_LIMITS;
type MediaPortName = keyof typeof MEDIA_PORTS;
type MiniMaxContent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly role: "reference_image";
      readonly type: "image_url";
      readonly image_url: { readonly url: string };
    }
  | {
      readonly role: "reference_audio";
      readonly type: "audio_url";
      readonly audio_url: { readonly url: string };
    };

export type MiniMaxH3ProviderOptions = {
  readonly instance: string;
  readonly pool: string;
  readonly baseUrl: string;
  readonly apiKey: CredentialRef;
  readonly resultOrigins?: readonly string[];
  readonly model?: string;
  readonly projectId?: string;
  readonly concurrency?: number;
  readonly pollIntervalMs?: number;
  readonly maxMediaBytes?: number;
  readonly pricingUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function object(value: unknown, subject: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${subject} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, subject: string): string {
  assert(typeof value === "string" && value.length > 0, `${subject} must be a non-empty string`);
  return value;
}

function safeText(value: string, secret?: string): string {
  let safe = value
    .replace(/https?:\/\/\S+/giu, "[redacted-url]")
    .replace(/\bBearer\s+\S+/giu, "Bearer [redacted]");
  if (secret !== undefined && secret.length > 0) safe = safe.replaceAll(secret, "[redacted]");
  return safe.slice(0, 800);
}

function parsedServiceUrl(value: string, subject: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${subject} is not a valid URL`);
  }
  assert(url.username === "" && url.password === "", `${subject} must not contain credentials`);
  const loopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]"
    || /^127\./u.test(url.hostname);
  assert(url.protocol === "https:" || (url.protocol === "http:" && loopback),
    `${subject} requires HTTPS or loopback HTTP`);
  return url;
}

function serviceUrl(value: string, subject: string): string {
  const url = parsedServiceUrl(value, subject);
  assert(url.search === "" && url.hash === "", `${subject} must not contain a query or fragment`);
  return url.href.replace(/\/+$/u, "");
}

function deploymentMediaUrl(
  value: unknown,
  subject: string,
  deployment: URL,
): string {
  const url = parsedServiceUrl(text(value, subject), subject);
  assert(url.origin === deployment.origin, `${subject} must belong to the configured deployment`);
  assert(url.pathname.startsWith("/media/"), `${subject} must use the deployment's /media/ path`);
  return url.href;
}

function parsedResultOrigin(value: string, subject: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${subject} is not a valid URL`);
  }
  assert(url.protocol === "https:", `${subject} requires HTTPS`);
  assert(url.username === "" && url.password === "", `${subject} must not contain credentials`);
  assert(url.pathname === "/" && url.search === "" && url.hash === "",
    `${subject} must be an origin without a path, query or fragment`);
  return url.origin;
}

function modelName(value: string): MiniMaxModel {
  assert(value in MODEL_LIMITS, "MiniMax H3 service model must be MiniMax-H3 or MiniMax-H3-Max");
  return value as MiniMaxModel;
}

function taskId(value: Record<string, unknown>): string {
  return text(value.task_id, "MiniMax H3 submission response task_id");
}

function publicFailure(
  value: Record<string, unknown>,
  secret: string,
): { code: string; message: string } | undefined {
  const nested = value.error;
  const error = nested !== null && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : value;
  const code = error.code ?? error.status_code;
  const message = error.message ?? error.status_msg;
  if (code === undefined && message === undefined) return undefined;
  return {
    code: typeof code === "string" || typeof code === "number"
      ? safeText(String(code), secret)
      : "MINIMAX_H3_ERROR",
    message: typeof message === "string"
      ? safeText(message, secret)
      : "MiniMax H3 service reported a failure",
  };
}

function responseRequestId(
  body: Record<string, unknown> | undefined,
  response: Response,
  secret?: string,
): string | undefined {
  const value = response.headers.get("x-request-id") ?? body?.requestId;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return safeText(String(value), secret);
}

function requestPorts(request: EndpointRequest): Record<string, unknown> | undefined {
  const constraints = request.constraints as unknown as GenerationRequest | undefined;
  const ports = constraints?.ports;
  return ports !== null && typeof ports === "object" && !Array.isArray(ports)
    ? ports as Record<string, unknown>
    : undefined;
}

function isMedia(value: unknown): value is GenerationMediaValue {
  return value !== null && typeof value === "object"
    && "role" in value
    && "artifact" in value;
}

function mediaTypeMatches(mediaType: string, expected: GenerationMediaRole): boolean {
  const normalized = mediaType.toLowerCase();
  return expected === "image"
    ? ALLOWED_IMAGE_MIME_TYPES.has(normalized)
    : ALLOWED_AUDIO_MIME_TYPES.has(normalized);
}

function requestIdempotencyKey(operation: string): string {
  return `hypit-h3-${createHash("sha256").update(operation).digest("hex")}`;
}

function mediaList(ports: Record<string, unknown>, portName: MediaPortName): readonly GenerationMediaValue[] {
  const values = ports[portName];
  if (values === undefined) return [];
  assert(Array.isArray(values), `MiniMax H3 port ${portName} is not a media list`);
  return values.map((value) => {
    assert(isMedia(value), `MiniMax H3 port ${portName} contains a non-media value`);
    return value;
  });
}

function requestOf(request: EndpointRequest): GenerationRequest {
  return request.constraints as unknown as GenerationRequest;
}

function contentItem(
  mapping: (typeof MEDIA_PORTS)[MediaPortName],
  url: string,
): MiniMaxContent {
  return {
    role: mapping.role,
    type: mapping.type,
    [mapping.key]: { url },
  } as MiniMaxContent;
}

export function createMiniMaxH3Provider(options: MiniMaxH3ProviderOptions) {
  const baseUrl = serviceUrl(options.baseUrl, "MiniMax H3 service baseUrl");
  const deployment = parsedServiceUrl(baseUrl, "MiniMax H3 service baseUrl");
  const resultOrigins = new Set((options.resultOrigins ?? []).map((value, index) =>
    parsedResultOrigin(
      text(value, `MiniMax H3 resultOrigins[${index}]`),
      `MiniMax H3 resultOrigins[${index}]`,
    )));
  const model = modelName(text(options.model ?? "MiniMax-H3", "MiniMax H3 service model"));
  const limits = MODEL_LIMITS[model];
  const projectId = options.projectId === undefined
    ? undefined
    : text(options.projectId, "MiniMax H3 service projectId");
  const fetcher = options.fetch ?? globalThis.fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const maxMediaBytes = options.maxMediaBytes ?? 100 * 1024 * 1024;
  assert(Number.isSafeInteger(pollIntervalMs) && pollIntervalMs > 0, "pollIntervalMs must be a positive integer");
  assert(Number.isSafeInteger(maxMediaBytes) && maxMediaBytes > 0, "maxMediaBytes must be a positive integer");
  const pricing = options.pricingUrl === undefined
    ? undefined
    : { kind: "page" as const, url: serviceUrl(options.pricingUrl, "MiniMax H3 pricingUrl") };

  function secret(credentials: Readonly<Record<string, { readonly secret: string }>>): string {
    return text(credentials.apiKey?.secret, "MiniMax H3 apiKey credential");
  }

  function resultMediaUrl(value: unknown, subject: string): string {
    if (resultOrigins.size === 0) return deploymentMediaUrl(value, subject, deployment);
    const url = parsedServiceUrl(text(value, subject), subject);
    assert(resultOrigins.has(url.origin), `${subject} must belong to configured resultOrigins`);
    return url.href;
  }

  async function apiJson(
    operation: string,
    path: string,
    apiKey: string,
    init: RequestInit,
  ): Promise<{ readonly body: Record<string, unknown>; readonly response: Response }> {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...init.headers,
        },
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error(`${operation} failed at transport`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      const requestId = responseRequestId(undefined, response, apiKey);
      throw new Error(`${operation} returned invalid JSON (HTTP ${response.status})`
        + (requestId === undefined ? "" : `; request=${requestId}`));
    }
    if (!response.ok) {
      let failure: ReturnType<typeof publicFailure>;
      if (body !== null && typeof body === "object" && !Array.isArray(body)) {
        failure = publicFailure(body as Record<string, unknown>, apiKey);
      }
      const requestId = responseRequestId(
        body !== null && typeof body === "object" && !Array.isArray(body)
          ? body as Record<string, unknown>
          : undefined,
        response,
        apiKey,
      );
      throw new Error(`${operation} returned HTTP ${response.status}`
        + (requestId === undefined ? "" : `; request=${requestId}`)
        + (failure === undefined ? "" : `; ${failure.code}: ${failure.message}`));
    }
    return { body: object(body, `${operation} response`), response };
  }

  function supportsRequest(request: EndpointRequest): EndpointSupport {
    const ports = requestPorts(request);
    if (ports === undefined) {
      return { status: "unsupported", reason: "MiniMax H3 request has no ports" };
    }
    const unknown = Object.keys(ports).find((name) => !KNOWN_PORTS.has(name));
    if (unknown !== undefined) {
      return {
        status: "unsupported",
        reason: `MiniMax H3 Open V2 does not support port ${unknown}; only referenceImage and referenceAudio are available`,
      };
    }

    const prompt = ports.prompt;
    if (!Array.isArray(prompt) || prompt.length !== 1
      || typeof prompt[0] !== "string" || prompt[0].trim().length === 0) {
      return { status: "unsupported", reason: "MiniMax H3 request requires one non-empty text prompt" };
    }
    if (prompt[0].length > MAX_PROMPT_CHARS) {
      return {
        status: "unsupported",
        reason: `MiniMax H3 prompt exceeds ${MAX_PROMPT_CHARS} characters`,
      };
    }

    const durationValues = ports.duration;
    if (!Array.isArray(durationValues) || durationValues.length !== 1
      || typeof durationValues[0] !== "number"
      || !Number.isInteger(durationValues[0])) {
      return { status: "unsupported", reason: "MiniMax H3 request requires one whole-second duration" };
    }
    const duration = durationValues[0];
    if (duration < limits.minimumDuration || duration > limits.maximumDuration) {
      return {
        status: "unsupported",
        reason: `${model} supports ${limits.minimumDuration}-${limits.maximumDuration} seconds, not ${duration}`,
      };
    }

    const resolutionValues = ports.resolution;
    if (!Array.isArray(resolutionValues) || resolutionValues.length !== 1) {
      return { status: "unsupported", reason: "MiniMax H3 request requires exactly one resolution" };
    }
    const resolution = resolutionValues[0];
    if (typeof resolution !== "string" || !limits.resolutions.includes(resolution as never)) {
      return {
        status: "unsupported",
        reason: `${model} requires one of ${limits.resolutions.join(" or ")}, not ${String(resolution)}`,
      };
    }

    const aspectRatioValues = ports.aspectRatio;
    if (aspectRatioValues !== undefined) {
      if (!Array.isArray(aspectRatioValues) || aspectRatioValues.length !== 1) {
        return { status: "unsupported", reason: "MiniMax H3 aspectRatio must contain one value" };
      }
      const aspectRatio = aspectRatioValues[0];
      if (typeof aspectRatio !== "string" || !ALLOWED_ASPECT_RATIOS.has(aspectRatio)) {
        return {
          status: "unsupported",
          reason: `MiniMax H3 Open V2 supports 9:16 or 16:9, not ${String(aspectRatio)}`,
        };
      }
    }

    for (const [portName, mapping] of Object.entries(MEDIA_PORTS) as
      [MediaPortName, (typeof MEDIA_PORTS)[MediaPortName]][]) {
      const values = ports[portName];
      if (values === undefined) continue;
      if (!Array.isArray(values)) {
        return { status: "unsupported", reason: `MiniMax H3 port ${portName} is not a media list` };
      }
      const maximum = portName === "referenceImage" ? MAX_REFERENCE_IMAGES : MAX_REFERENCE_AUDIO;
      if (values.length > maximum) {
        return {
          status: "unsupported",
          reason: `MiniMax H3 Open V2 accepts at most ${maximum} ${mapping.media} references, not ${values.length}`,
        };
      }
      for (const value of values) {
        if (!isMedia(value)) {
          return { status: "unsupported", reason: `MiniMax H3 port ${portName} contains a non-media value` };
        }
        if (value.role !== mapping.media) {
          return {
            status: "unsupported",
            reason: `MiniMax H3 port ${portName} requires a ${mapping.media} artifact`,
          };
        }
        if (!mediaTypeMatches(value.artifact.mediaType, mapping.media)) {
          return {
            status: "unsupported",
            reason: `MiniMax H3 port ${portName} requires an ${mapping.media} MIME type`,
          };
        }
        if (value.artifact.size > maxMediaBytes) {
          return {
            status: "unsupported",
            reason: `MiniMax H3 ${mapping.media} input exceeds maxMediaBytes (${maxMediaBytes})`,
          };
        }
      }
    }

    const images = Array.isArray(ports.referenceImage) ? ports.referenceImage.length : 0;
    const audio = Array.isArray(ports.referenceAudio) ? ports.referenceAudio.length : 0;
    if (audio > 0 && images === 0) {
      return {
        status: "unsupported",
        reason: "MiniMax H3 reference audio requires at least one reference image",
      };
    }
    if (1 + images + audio > MAX_CONTENT_ITEMS) {
      return { status: "unsupported", reason: `MiniMax H3 content exceeds ${MAX_CONTENT_ITEMS} items` };
    }
    return { status: "supported" };
  }

  function uploadedAssetUrl(
    body: Record<string, unknown>,
    response: Response,
  ): string {
    const single = body.asset !== null && typeof body.asset === "object" && !Array.isArray(body.asset)
      ? (body.asset as Record<string, unknown>).url
      : undefined;
    const first = Array.isArray(body.assets)
      && body.assets[0] !== null
      && typeof body.assets[0] === "object"
      && !Array.isArray(body.assets[0])
      ? (body.assets[0] as Record<string, unknown>).url
      : undefined;
    const value = single ?? first;
    if (typeof value !== "string" || value.length === 0) {
      const requestId = responseRequestId(body, response);
      throw new Error("MINIMAX_H3_ASSET_URL_MISSING: upload returned asset IDs but no media URL"
        + (requestId === undefined ? "" : `; request=${requestId}`));
    }
    return deploymentMediaUrl(
      value,
      "MiniMax H3 asset URL",
      deployment,
    );
  }

  async function uploadMedia(
    bytes: Uint8Array,
    mediaType: string,
    apiKey: string,
    filename: string,
  ): Promise<string> {
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(bytes)], { type: mediaType }), filename);
    const query = projectId === undefined ? "" : `?projectId=${encodeURIComponent(projectId)}`;
    const result = await apiJson(
      "MiniMax H3 asset upload",
      `/v1/assets${query}`,
      apiKey,
      { method: "POST", body: form },
    );
    return uploadedAssetUrl(result.body, result.response);
  }

  async function compileContent(
    request: GenerationRequest,
    context: Parameters<NonNullable<AsyncEndpoint["start"]>>[0],
    apiKey: string,
  ): Promise<readonly MiniMaxContent[]> {
    const prompt = request.ports.prompt?.[0];
    assert(typeof prompt === "string", "MiniMax H3 request has no text prompt");
    const content: MiniMaxContent[] = [{ type: "text", text: prompt }];
    for (const [portName, mapping] of Object.entries(MEDIA_PORTS) as
      [MediaPortName, (typeof MEDIA_PORTS)[MediaPortName]][]) {
      const values = mediaList(request.ports, portName);
      for (const [index, value] of values.entries()) {
        assert(value.role === mapping.media, `MiniMax H3 port ${portName} has the wrong media role`);
        assert(mediaTypeMatches(value.artifact.mediaType, mapping.media),
          `MiniMax H3 port ${portName} requires an ${mapping.media} MIME type`);
        assert(value.artifact.size <= maxMediaBytes,
          `MiniMax H3 ${mapping.media} input exceeds maxMediaBytes (${maxMediaBytes})`);
        await context.reportProgress?.({ phase: `Reading ${mapping.media} input for ${portName}` });
        const bytes = await context.resources.get(value.artifact.resource);
        assert(bytes !== undefined, `MiniMax H3 ${mapping.media} input is unavailable`);
        assert(bytes.byteLength <= maxMediaBytes,
          `MiniMax H3 ${mapping.media} input exceeds maxMediaBytes (${maxMediaBytes})`);
        await context.reportProgress?.({ phase: `Uploading ${mapping.media} input for ${portName}` });
        const extension = value.artifact.mediaType.split("/")[1]?.replace(/[^a-z0-9.+-]/giu, "") || "bin";
        const url = await uploadMedia(
          bytes,
          value.artifact.mediaType,
          apiKey,
          `${portName}-${index + 1}.${extension}`,
        );
        content.push(contentItem(mapping, url));
      }
    }
    return content;
  }

  const endpoint: AsyncEndpoint = {
    async start(context) {
      const supported = supportsRequest(context.need);
      if (supported.status === "unsupported") throw new Error(supported.reason);
      const apiKey = secret(context.credentials);
      const request = requestOf(context.need);
      await context.reportProgress?.({ phase: `Preparing ${model} request` });
      const content = await compileContent(request, context, apiKey);
      const duration = request.ports.duration?.[0];
      assert(typeof duration === "number", "MiniMax H3 request has no duration");
      const resolution = request.ports.resolution?.[0];
      assert(typeof resolution === "string", "MiniMax H3 request has no resolution");
      const ratio = request.ports.aspectRatio?.[0];
      const body = canonicalize({
        model,
        duration,
        resolution,
        ...(ratio === undefined ? {} : { ratio }),
        content,
        idempotencyKey: requestIdempotencyKey(context.operation),
        ...(projectId === undefined ? {} : { projectId }),
      });
      await context.reportProgress?.({ phase: `Submitting ${model} request` });
      const task = await apiJson(
        "MiniMax H3 submit",
        "/v2/video_generation",
        apiKey,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const id = taskId(task.body);
      const handle = { id };
      const receipt = { id };
      await context.checkpoint?.({ handle, receipt });
      return { ...wakeAfter(handle, pollIntervalMs, Date.now(), { phase: "queued" }), receipt };
    },

    async poll(context) {
      const handle = object(context.handle, "MiniMax H3 handle");
      const id = text(handle.id, "MiniMax H3 task id");
      const transportRetries = handle.transportRetries ?? 0;
      assert(typeof transportRetries === "number"
        && Number.isSafeInteger(transportRetries)
        && transportRetries >= 0,
        "MiniMax H3 transportRetries must be a non-negative integer");
      const apiKey = secret(context.credentials);
      let result: Awaited<ReturnType<typeof apiJson>>;
      try {
        result = await apiJson(
          "MiniMax H3 query",
          `/v2/query/video_generation/${encodeURIComponent(id)}`,
          apiKey,
          { method: "GET" },
        );
      } catch (error) {
        const retryable = error instanceof Error
          && error.message === "MiniMax H3 query failed at transport";
        if (!retryable || transportRetries >= MAX_POLL_TRANSPORT_RETRIES) throw error;
        const retry = transportRetries + 1;
        return wakeAfter(
          { id, transportRetries: retry },
          pollIntervalMs,
          Date.now(),
          { phase: `Retrying query after transport failure (${retry}/${MAX_POLL_TRANSPORT_RETRIES})` },
        );
      }
      const task = object(result.body.task, "MiniMax H3 query response task");
      if (task.id !== undefined && task.id !== id) {
        throw new Error("MiniMax H3 query returned a different task id");
      }
      const status = text(task.status, "MiniMax H3 task status").toLowerCase();
      if (status === "queued" || status === "running") {
        return wakeAfter({ id }, pollIntervalMs, Date.now(), { phase: status });
      }
      if (status === "cancelled") {
        return {
          status: "failed",
          receipt: { id },
          failure: {
            code: "MINIMAX_H3_CANCELLED",
            message: `MiniMax H3 task ${id} was cancelled`,
          },
        };
      }
      if (status === "failed") {
        const failure = publicFailure(task, apiKey);
        return {
          status: "failed",
          receipt: { id },
          failure: {
            code: failure?.code ?? "MINIMAX_H3_FAILED",
            message: `MiniMax H3 task ${id} failed${failure === undefined ? "" : `: ${failure.message}`}`,
          },
        };
      }
      if (status !== "succeeded") {
        throw new Error(`MiniMax H3 returned unknown task status ${safeText(status, apiKey)}`);
      }
      const content = object(task.content, "MiniMax H3 succeeded task content");
      return {
        status: "ready",
        handle: {
          id,
          url: resultMediaUrl(content.url, "MiniMax H3 result URL"),
        },
        receipt: { id },
      };
    },

    async cancel(context): Promise<EndpointCancelOutcome> {
      const id = text(object(context.handle, "MiniMax H3 handle").id, "MiniMax H3 task id");
      const apiKey = secret(context.credentials);
      let response: Response;
      try {
        response = await fetcher(`${baseUrl}/v2/video_generation/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        throw new Error("MiniMax H3 cancel failed at transport");
      }
      let body: Record<string, unknown> | undefined;
      try {
        const raw = await response.text();
        if (raw.trim().length > 0) {
          body = object(JSON.parse(raw), "MiniMax H3 cancel response");
        }
      } catch {
        throw new Error(`MiniMax H3 cancel returned invalid JSON (HTTP ${response.status})`);
      }
      if (response.ok) {
        if (body !== undefined) {
          const action = body.action;
          const status = body.status;
          assert(action === undefined || action === "cancelled",
            "MiniMax H3 cancel response has an unexpected action");
          assert(status === undefined || status === "cancelled",
            "MiniMax H3 cancel response has an unexpected status");
          assert(action === "cancelled" || status === "cancelled",
            "MiniMax H3 cancel response did not confirm cancellation");
        }
        return { status: "accepted" };
      }
      let failure: ReturnType<typeof publicFailure>;
      if (body !== undefined) {
        failure = publicFailure(body, apiKey);
      }
      if (failure?.code !== undefined && CANCELLATION_TOO_LATE_CODES.has(failure.code)) {
        return { status: "too-late" };
      }
      if (response.status === 404 || response.status === 409) return { status: "too-late" };
      const requestId = responseRequestId(body, response, apiKey);
      throw new Error(`MiniMax H3 cancel returned HTTP ${response.status}`
        + (requestId === undefined ? "" : `; request=${requestId}`)
        + (failure === undefined ? "" : `; ${failure.code}: ${failure.message}`));
    },

    async collect(context) {
      const raw = object(context.handle, "MiniMax H3 handle");
      const url = resultMediaUrl(raw.url, "MiniMax H3 result URL");
      await context.reportProgress?.({ phase: "Downloading MiniMax H3 video" });
      let response: Response;
      try {
        response = await fetcher(url, { signal: AbortSignal.timeout(600_000) });
      } catch {
        throw new Error("MiniMax H3 video download failed at transport");
      }
      if (!response.ok) throw new Error(`MiniMax H3 video download returned HTTP ${response.status}`);
      const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      assert(mediaType?.startsWith("video/") === true, "MiniMax H3 download is not a video");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const artifact = await context.resources.put(bytes, mediaType);
      return {
        status: "completed",
        result: {
          value: {
            kind: "inline",
            value: canonicalize(sealGeneratedVideoSet({ videos: [artifact] })) as CanonicalValue,
          },
        },
      };
    },
  };

  return defineEndpoint({
    instance: options.instance,
    pool: options.pool,
    credentials: { apiKey: options.apiKey },
    credentialInputs: { apiKey: { label: "MiniMax H3 API key" } },
    defaultConcurrency: options.concurrency ?? 1,
    actionLimits: {
      submit: { concurrency: 1 },
      poll: { concurrency: 4 },
      collect: { concurrency: 2 },
    },
    ...(pricing === undefined ? {} : { pricing }),
    capabilities: [{
      capability,
      returns: generationTypes.videoSet,
      lifecycle: "asynchronous",
      supports: supportsRequest,
      endpoint,
    }],
  });
}
