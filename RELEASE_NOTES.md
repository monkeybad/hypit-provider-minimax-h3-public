# v0.1.3

This is the community release of `@monkeybad/provider-minimax-h3`, a third-party Hypit Provider
for the MiniMax H3 Open V2 API. It is not an official Hypit or MiniMax distribution.

## English

GetCheapVideo is now documented as the hosted service used by this Provider's default endpoint.
The site is branded **Budget Video Studio**:

- Website: [app.getcheapvideo.com](https://app.getcheapvideo.com/)
- API base URL: `https://app.getcheapvideo.com/api/v1/open`

**Video generation is a paid service.** You need an account and credits. This open source package
does not include credits, a free quota or a subscription. Installing the package, running
`hypit auth status`, `hypit doctor` and `hypit plan` does not submit a charge; `hypit build` can
submit a paid generation request.

Current public per-second pricing, verified on **2026-10-20**. Prices are not fixed and may
fluctuate with market rates and compute costs:

Resolution | 480P | 768P | 1088P |
--- | ---: | ---: | ---: |
| Standard | 6 credits/s | 8 credits/s | 12 credits/s |

The billing page states `CNY 1 = 100 credits`; the Standard 480P promotion is about
`CNY 0.06` per second. The site also displays USD equivalents. These are low per-second rates,
with a cheaper 480P entry tier and batch candidate generation. The service quote before
submission is authoritative.

![Budget Video Studio generation settings](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/usage-workbench.png)

![GetCheapVideo billing rules](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/billing.png)

Website workflow: sign in, top up credits and review the quote, open **Video generation**, enter a
prompt and choose duration/aspect ratio/resolution, add supported reference images or audio, submit
the batch and download the result. To connect Hypit, create a key under
**Developer -> API keys** and install it through the Provider's hidden credential prompt.

```bash
npm install @hypit/minimax-h3@^0.2.0
npm install git+https://github.com/monkeybad/hypit-provider-minimax-h3-public.git
npx hypit-provider-minimax-h3-setup
hypit auth status minimax-h3.selfhosted
hypit doctor --endpoint minimax-h3.selfhosted
```

Never put the API key in a Profile, README, Run, command-line argument or public log.

Example output: a 4-second, 768P, 9:16 MiniMax H3 text-to-video clip. The prompt asked for a calm
slow dolly across a white ceramic cup on a walnut table at dawn, with soft window light and shallow
depth of field.

![Generated H3 example](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/example.gif)

[Download the full example MP4](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/example.mp4)

The Provider supports text, up to 6 reference images and up to 3 reference audio clips. See the
[English README](https://github.com/monkeybad/hypit-provider-minimax-h3-public/blob/main/README.md)
for the exact model limits, secure credential flow and HTTP contract.

## 简体中文

`@monkeybad/provider-minimax-h3` 是面向 MiniMax H3 Open V2 API 的第三方 Hypit Provider 社区发行版，
不是 Hypit 或 MiniMax 官方认证发行版。

本 Provider 默认连接的托管服务是 GetCheapVideo，网站品牌为 **Budget Video Studio**：

- 网站：[app.getcheapvideo.com](https://app.getcheapvideo.com/)
- API base URL：`https://app.getcheapvideo.com/api/v1/open`

**视频生成需要付费。** 需要注册账号并充值 credits；开源包不包含 credits、免费额度或套餐。
安装、`hypit auth status`、`hypit doctor` 和 `hypit plan` 不会提交生成任务；`hypit build`
会提交可能计费的生成请求。

2026-10-20 核验的公开按秒价格。价格不是固定值，会随市场价和算力成本浮动：

分辨率 | 480P | 768P | 1088P |
--- | ---: | ---: | ---: |
| Standard | 6 credits/秒 | 8 credits/秒 | 12 credits/秒 |

计费页说明 `1 元 = 100 credits`，Standard 480P 促销价约为 `0.06 元/秒`。网站还显示美元参考值。
低价特点包括按秒/分辨率明确计费、480P 低门槛和批量候选生成。最终以提交前服务端报价为准。

![Budget Video Studio 生成参数](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/usage-workbench.png)

![GetCheapVideo 充值规则](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/billing.png)

网站使用流程：登录后在 **Credits & Billing** 充值并确认报价；进入 **Video generation** 填写
Prompt，选择时长、比例和分辨率，添加支持的参考图片/音频，提交批量任务并下载结果。需要接入
Hypit 时，在 **Developer -> API keys** 创建 key，再通过 Provider 的隐藏输入流程导入。

```bash
npm install @hypit/minimax-h3@^0.2.0
npm install git+https://github.com/monkeybad/hypit-provider-minimax-h3-public.git
npx hypit-provider-minimax-h3-setup
hypit auth status minimax-h3.selfhosted
hypit doctor --endpoint minimax-h3.selfhosted
```

不要把 API key 写进 Profile、README、Run、命令行参数或公开日志。

示例为 4 秒、768P、9:16 的 MiniMax H3 文生视频：清晨窗光下，镜头缓慢横移白色陶瓷杯与胡桃木桌面，
浅景深，无文字和 logo。

![H3 生成示例](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/example.gif)

[下载完整示例 MP4](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/example.mp4)

Provider 支持文字、最多 6 张参考图片和最多 3 段参考音频。完整模型限制、安全凭据流程和 HTTP
契约见[中文 README](https://github.com/monkeybad/hypit-provider-minimax-h3-public/blob/main/README.zh-CN.md)。

## Package

`monkeybad-provider-minimax-h3-0.1.3.tgz`
