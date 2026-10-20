import {
  createRuntimeEndpointAdapterFacet,
  runtimeConfigCredentialRef,
  runtimeConfigExact,
  runtimeConfigObject,
  runtimeConfigPositiveInteger,
  runtimeConfigString,
} from "@hypit/runtime-local/extension";
import { createMiniMaxH3Provider, providerModule } from "./provider.js";

function runtimeConfigStringList(
  value: unknown,
  subject: string,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)
    || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`${subject} must be an array of non-empty strings`);
  }
  return value as readonly string[];
}

export const hypitPackage = {
  format: "hypit.package@1" as const,
  facets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "MiniMax H3 service");
      runtimeConfigExact(config, [
        "protocol",
        "baseUrl",
        "apiKey",
        "resultOrigins",
        "model",
        "projectId",
        "concurrency",
        "pollIntervalMs",
        "maxMediaBytes",
        "pricingUrl",
      ], "MiniMax H3 service");

      if (runtimeConfigString(config.protocol, "protocol") !== "minimax-h3-open-v2") {
        throw new Error('MiniMax H3 service protocol must be "minimax-h3-open-v2"');
      }
      const baseUrl = runtimeConfigString(config.baseUrl, "MiniMax H3 service baseUrl");
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "MiniMax H3 service apiKey");
      if (!baseUrl || !apiKey || !context.pool) {
        throw new Error("MiniMax H3 service requires baseUrl, apiKey and pool");
      }

      const pricingUrl = runtimeConfigString(config.pricingUrl, "MiniMax H3 service pricingUrl");
      const projectId = runtimeConfigString(config.projectId, "MiniMax H3 service projectId");
      const resultOrigins = runtimeConfigStringList(
        config.resultOrigins,
        "MiniMax H3 service resultOrigins",
      );
      return {
        endpoint: createMiniMaxH3Provider({
          instance: context.instance,
          pool: context.pool,
          baseUrl,
          apiKey,
          ...(resultOrigins === undefined ? {} : { resultOrigins }),
          model: runtimeConfigString(config.model, "MiniMax H3 service model") ?? "MiniMax-H3",
          ...(projectId === undefined ? {} : { projectId }),
          concurrency: runtimeConfigPositiveInteger(config.concurrency, "concurrency") ?? 1,
          pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, "pollIntervalMs") ?? 5_000,
          maxMediaBytes: runtimeConfigPositiveInteger(config.maxMediaBytes, "maxMediaBytes") ?? 100 * 1024 * 1024,
          ...(pricingUrl === undefined ? {} : { pricingUrl }),
        }),
      };
    },
  })],
};

export default hypitPackage;
