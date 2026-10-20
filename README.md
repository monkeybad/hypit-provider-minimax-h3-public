# `@monkeybad/provider-minimax-h3`

[English](README.md) | [简体中文](README.zh-CN.md)

Third-party Hypit Provider for a self-hosted MiniMax H3 Open V2 API. It implements the existing
Hypit capability:

```text
@hypit/minimax-h3@1#minimax-h3
```

This is an independent community package. It is not an official Hypit or MiniMax distribution.
The operator of the configured API deployment remains responsible for service availability,
model access, pricing, data handling and API compatibility.

## GetCheapVideo / Budget Video Studio

[GetCheapVideo](https://app.getcheapvideo.com/) is the hosted video service used by the default
endpoint in this package. The site is branded **Budget Video Studio** and describes itself as a
batch video workbench with image/audio references and prompt compilation.

**The service is paid.** You need a GetCheapVideo account and credits to generate video. The open
source Provider does not include a subscription, free quota or generation credits. Installing the
package and running diagnostics is free; `hypit build` can submit a paid generation request.

Prices below were checked on **2026-10-20** on the public price display. Promotions and rates can
change, so the quote shown by the service before submission is authoritative.

| Service tier | 480P | 768P | 1088P |
| --- | ---: | ---: | ---: |
| Standard | 6 credits/s | 8 credits/s | 12 credits/s |
| VIP | 5 credits/s | 7 credits/s | 10 credits/s |

The billing page states `CNY 1 = 100 credits`. At that conversion, the Standard promotion is about
`CNY 0.06` per second at 480P. The public rate display also shows the USD equivalents:
Standard `$0.06 / $0.08 / $0.12` per second and VIP `$0.05 / $0.07 / $0.10` per second for
480P / 768P / 1088P.

The low-price characteristics are explicit per-second and per-resolution rates, a low 480P
promotional entry price, lower VIP rates, and batch candidate generation in one workbench. The
service also provides reference image/audio slots and prompt compilation. Prices are not a promise
of unlimited output: duration, resolution, candidates and actual server quotes determine the final
charge.

![Generation settings in Budget Video Studio](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/usage-workbench.png)

*Generation settings for duration, aspect ratio and resolution.*

![Current public GetCheapVideo pricing](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/pricing.png)

*Current public per-second pricing. Verify the quote before submitting a paid request.*

![Credits and billing rules](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/billing.png)

*Credits are purchased before use; the screenshot contains only the public billing rules.*

### Use the website

1. Open [app.getcheapvideo.com](https://app.getcheapvideo.com/) and register or sign in.
2. Open **Credits & Billing**, top up credits and review the displayed price. The current page
   supports Alipay top-ups of `CNY 1-50` per order; larger top-ups are handled through its
   support channel. The server quote is final.
3. Open **Video generation**. Enter a prompt and choose duration, aspect ratio and resolution.
   Add reference images or audio when the selected model supports them.
4. Review the estimated reservation, submit the batch and download the completed video from the
   task results.
5. To connect Hypit, open **Developer -> API keys** and create an API key for the same account.
   Keep the key private.

The website price table and this Provider's declared API subset are related but not identical.
The website currently lists a 1088P tier; the Provider exposes only the Open V2 values documented
under [Supported request subset](#supported-request-subset). Do not assume every website control
is accepted by this adapter.

### Example output

The following 4-second, 768P, 9:16 sample was generated through MiniMax H3 with this line of
text-to-video direction: *"A calm slow dolly across a white ceramic cup on a walnut table at dawn,
soft window light, shallow depth of field, no text, no logos."*

![Generated H3 example](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/example.gif)

[Open or download the full MP4](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/example.mp4).

### Connect the website API to Hypit

From the Hypit project that will use the Provider:

```bash
npm install @hypit/minimax-h3@^0.2.0
npm install git+https://github.com/monkeybad/hypit-provider-minimax-h3-public.git
npx hypit-provider-minimax-h3-setup
hypit auth status minimax-h3.selfhosted
hypit doctor --endpoint minimax-h3.selfhosted
hypit plan productions/example/example.svrun
```

The setup command writes a credential reference, starts the hidden credential prompt and does not
accept the API key as a command-line argument. Never put the key in `hypit.runtime.json`, a Run,
this README, a shell command or a public CI log. If the key is already in a private file, use:

```bash
hypit auth login minimax-h3.selfhosted --from /private/path/minimax-h3-key.txt
```

`auth status`, `doctor` and `plan` do not submit paid generation. Only `hypit build` submits a
potentially billable request.

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
