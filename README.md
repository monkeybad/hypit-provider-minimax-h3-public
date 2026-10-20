# `@monkeybad/provider-minimax-h3`

Third-party Hypit Provider for a self-hosted MiniMax H3 Open V2 API. It implements the existing
Hypit capability:

```text
@hypit/minimax-h3@1#minimax-h3
```

This is an independent community package. It is not an official Hypit or MiniMax distribution.
The operator of the configured API deployment remains responsible for service availability,
model access, pricing, data handling and API compatibility.

## What it does

- Accepts a text prompt plus the deployment's supported `referenceImage` and `referenceAudio`
  inputs.
- Uploads references, submits an asynchronous generation task, polls it, downloads the result and
  admits it into Hypit's resource system.
- Preserves a task receipt for continuation and uses a stable idempotency key for submission.
- Retries transient status-query transport failures without treating the remote task as failed.
- Supports cancellation and reports late-cancellation states without inventing success.
- Validates the endpoint, asset URLs and result URLs. Result downloads require either the
  deployment's `/media/` path or an explicit `resultOrigins` allowlist. Credentials and signed URLs
  are redacted from public failure messages.
- Declares the API key as a writable Hypit credential, so `hypit auth login` can prompt for it
  securely.

The Provider does not grant credits, install Hypit, create an Endpoint by itself or prove that an
API key is accepted by the deployment.

## Install

Install both the H3 Model and this Provider from public GitHub/npm in the Hypit project that will
use it:

```bash
npm install @hypit/minimax-h3@^0.2.0
npm install git+https://github.com/monkeybad/hypit-provider-minimax-h3-public.git
```

The Model package supplies the `@hypit/minimax-h3@1#minimax-h3` author/compute contract used by
Studio and project projection. The Provider package maps that capability to the deployment API and
is built during installation through its `prepare` script. An npm registry release is not required
for this Git-based Provider installation.

## Run setup

From the Hypit project, run the installed setup command:

```bash
npx hypit-provider-minimax-h3-setup
```

The setup command:

- creates a starter `hypit.runtime.json` when the project has none;
- merges the H3 Endpoint and capability binding while retaining unrelated Endpoints, credential
  stores and bindings;
- records only a credential reference, never an API key;
- starts `hypit auth login minimax-h3.selfhosted`, where Hypit securely prompts for the key and
  stores it in the selected local Credential Store.

Use `--no-login` to configure without prompting. Use `--help` for custom endpoint names, API base
URLs, result origins and model selection. The setup command does not accept a key argument,
environment variable or key file.

Check the connection without generating a video:

```bash
hypit auth status minimax-h3.selfhosted
hypit doctor --endpoint minimax-h3.selfhosted
```

## Configure manually

Merge the Provider's `use` value into an existing `hypit.runtime.json`. Do not replace unrelated
Endpoints or bindings.

```json
{
  "credentials": {
    "local": { "use": "@hypit/credential-store-local" }
  },
  "endpoints": {
    "minimax-h3.selfhosted": {
      "use": "@monkeybad/provider-minimax-h3",
      "config": {
        "protocol": "minimax-h3-open-v2",
        "baseUrl": "https://app.getcheapvideo.com/api/v1/open",
        "model": "MiniMax-H3",
        "apiKey": {
          "store": "local",
          "key": "minimax-h3.selfhosted"
        },
        "resultOrigins": [
          "https://res.getcheapvideo.com"
        ],
        "concurrency": 1,
        "pollIntervalMs": 5000,
        "maxMediaBytes": 104857600
      }
    }
  },
  "bindings": {
    "@hypit/minimax-h3@1#minimax-h3": "minimax-h3.selfhosted"
  }
}
```

The complete Profile must also contain `format: "hypit.runtime-local@1"` and a `dataRoot`. The
package name in `use` must exactly match `package.json`.

`apiKey` is a credential reference, not the secret itself. Do not put the actual key in the
Profile, Source, Run, README or Git.

`resultOrigins` is optional and uses exact HTTPS origins only. Configure it when the deployment
serves completed videos from a media CDN rather than the API gateway's `/media/` path. Entries
cannot include credentials, a path, query or fragment. If the list is omitted, result URLs remain
restricted to the deployment origin and its `/media/` path. Do not add wildcard or arbitrary
redirecting origins.

## Enter the API key securely

Run the login command from the Hypit project using this Provider:

```bash
hypit auth login minimax-h3.selfhosted
```

The Provider declares the credential input label `MiniMax H3 API key`, so Hypit prompts for the key
and stores it through the selected local Credential Store. The key is not passed through the
command line or chat.

If the key is already held in a private file, import it without printing it:

```bash
hypit auth login minimax-h3.selfhosted --from /private/path/minimax-h3-key.txt
```

Check configuration and routing without generating a video:

```bash
hypit auth status minimax-h3.selfhosted
hypit doctor --endpoint minimax-h3.selfhosted
hypit plan productions/example/example.svrun
```

`auth status` reports that a credential exists. `doctor` performs bounded connection diagnostics.
Only `hypit build` submits a potentially paid generation request.

## Supported request subset

| Hypit port | Open V2 content | Limit |
| --- | --- | --- |
| `prompt` | `text` | 7,000 characters |
| `referenceImage` | `reference_image` | 6 |
| `referenceAudio` | `reference_audio` | 3 |

`duration`, `resolution` and `aspectRatio` accept exactly one value when present. `resolution` is
required.

| Service model | Duration | Resolution |
| --- | --- | --- |
| `MiniMax-H3` | 4-15 seconds | `768P` or `2K` |
| `MiniMax-H3-Max` | 5-15 seconds | `480P` or `768P` |

Supported aspect ratios are `9:16` and `16:9`. Audio requires at least one reference image. The
gateway subset rejects `referenceVideo`, `firstFrame`, `lastFrame` and unknown ports before upload
or submission.

## Known reference-media limitation

The configured gateway's `POST /v1/assets` may return an asset ID without a `/media/` URL, while
Open V2 submission requires a media URL. In that case the Provider fails with
`MINIMAX_H3_ASSET_URL_MISSING` and does not submit a guessed URL.

Text-only generation remains available because it does not upload media. Reference-image and
reference-audio generation become available only when the deployment returns a usable media URL
or documents an authenticated lookup by asset ID.

## HTTP contract

```text
POST   {baseUrl}/v1/assets?projectId=...
POST   {baseUrl}/v2/video_generation
GET    {baseUrl}/v2/query/video_generation/{task_id}
DELETE {baseUrl}/v2/video_generation/{task_id}
```

Calls that access the service use `Authorization: Bearer <apiKey>`. Result download deliberately
does not send the API key.

The default deployment address is
`https://app.getcheapvideo.com/api/v1/open`. It is configurable because the full request and
response protocol must match this Open V2 adapter.

## Development

```bash
npm ci
npm test
npm run build
npm pack --dry-run
```

The tests use a fake HTTP service and do not require an API key or a paid generation request.

## License

MIT. See [LICENSE](LICENSE). Security reporting guidance is in [SECURITY.md](SECURITY.md).
