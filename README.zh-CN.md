# `@monkeybad/provider-minimax-h3`

[English](README.md) | [简体中文](README.zh-CN.md)

这是一个面向自部署 MiniMax H3 Open V2 API 的第三方 Hypit Provider，实现以下 Hypit capability：

```text
@hypit/minimax-h3@1#minimax-h3
```

本包是独立社区项目，不是 Hypit 或 MiniMax 官方认证发行版。所连接 API 的可用性、模型权限、
价格、数据处理和协议兼容性由服务运营方负责。

## GetCheapVideo / Budget Video Studio

[GetCheapVideo](https://app.getcheapvideo.com/) 是本包默认 Endpoint 使用的托管视频服务。网站品牌为
**Budget Video Studio**，提供图片/音频参考、Prompt 编译和批量视频抽卡工作台。

**该服务需要付费使用。** 你需要有 GetCheapVideo 账号并充值 credits 才能生成视频。开源 Provider
本身不包含套餐、免费额度或生成 credits。安装和诊断不会产生生成费用；`hypit build` 才会提交可能
计费的生成请求。

以下价格于 **2026-10-20** 从网站公开费率区核验。价格不是固定值，会随市场价和算力成本浮动，
最终以提交前服务端返回的报价为准。

分辨率 | 480P | 768P | 1088P |
--- | ---: | ---: | ---: |
| Standard | 6 credits/秒 | 8 credits/秒 | 12 credits/秒 |

计费页说明 `CNY 1 = 100 credits`。按此换算，Standard 480P 促销价约为 `0.06 元/秒`。网站公开费率
同时显示美元参考值：Standard 为 `$0.06 / $0.08 / $0.12` 每秒，分别对应
480P / 768P / 1088P。

低价特点包括：按秒和分辨率明确计费、480P 促销入口价较低，以及在一个工作台内批量生成候选。
网站还提供参考图片/音频槽位和 Prompt 编译。低价不等于无限量，最终费用由时长、分辨率、候选数量
和实际服务端报价共同决定。

![Budget Video Studio 生成参数](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/usage-workbench.png)

*时长、画面比例和分辨率设置。*

![充值规则](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/billing.png)

*先充值 credits 再使用；截图只保留公开计费规则，不含账号和余额。*

### 网站使用步骤

1. 打开 [app.getcheapvideo.com](https://app.getcheapvideo.com/)，注册或登录。
2. 进入 **Credits & Billing**，充值 credits 并查看页面报价。当前页面支持支付宝单笔
   `1-50 元`充值，大额充值按页面提示联系客服；最终价格以提交时的服务端报价为准。
3. 进入 **Video generation**，填写 Prompt，选择时长、画面比例和分辨率。模型支持时，可添加
   参考图片或参考音频。
4. 检查预计预占额度，提交批量任务，然后在任务结果中下载生成的视频。
5. 如需连接 Hypit，进入 **Developer -> API keys** 为同一账号创建 API key，并妥善保管。

网站的公开价格档位与本 Provider 实际声明的 API 子集不是同一张能力表。网站当前列出 1088P 档位；
Provider 只开放下文“支持的请求子集”中列出的 Open V2 参数，不能因为网页有某个控件就推断 Provider
一定接受该参数。

### 生成示例

下面的 4 秒、768P、9:16 示例通过 MiniMax H3 生成，文字提示为：
“A calm slow dolly across a white ceramic cup on a walnut table at dawn, soft window light,
shallow depth of field, no text, no logos.”

![H3 生成示例](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/example.gif)

[打开或下载完整 MP4](https://raw.githubusercontent.com/monkeybad/hypit-provider-minimax-h3-public/main/docs/getcheapvideo/example.mp4)

### 把网站 API 接入 Hypit

在需要使用该 Provider 的 Hypit 工程中执行：

```bash
npm install @hypit/minimax-h3@^0.2.0
npm install git+https://github.com/monkeybad/hypit-provider-minimax-h3-public.git
npx hypit-provider-minimax-h3-setup
hypit auth status minimax-h3.selfhosted
hypit doctor --endpoint minimax-h3.selfhosted
hypit plan productions/example/example.svrun
```

`setup` 只写入凭据引用，随后由 Hypit 以隐藏输入方式询问 API key；它不接受把 key 作为命令行参数。
不要把 API key 写入 `hypit.runtime.json`、Run、README、命令行或公开 CI 日志。如果 key 已保存在私有
文件中，可使用：

```bash
hypit auth login minimax-h3.selfhosted --from /private/path/minimax-h3-key.txt
```

`auth status`、`doctor` 和 `plan` 不会提交付费生成任务。只有 `hypit build` 会提交可能计费的请求。

## 功能

- 接受文字 Prompt，以及部署支持的 `referenceImage` 和 `referenceAudio` 输入。
- 上传参考素材，提交异步生成任务，轮询状态，下载结果并纳入 Hypit 资源系统。
- 保存 task receipt，使用稳定的 idempotency key，并对状态查询的瞬时传输故障进行重试。
- 支持取消，并如实报告取消后的远程状态。
- 校验 Endpoint、素材 URL 和结果 URL；结果下载只允许部署的 `/media/` 路径或显式
  `resultOrigins` allowlist。
- 凭据和签名 URL 会从公开错误信息中脱敏。
- 将 API key 声明为可写的 Hypit credential，使 `hypit auth login` 可以安全询问。

Provider 不赠送 credits，不负责安装 Hypit，不会自行创建 Endpoint，也不能证明某个 API key
一定被远端服务接受。

## 安装

在要使用该 Provider 的 Hypit 工程中，同时安装 H3 Model 和本 Provider：

```bash
npm install @hypit/minimax-h3@^0.2.0
npm install git+https://github.com/monkeybad/hypit-provider-minimax-h3-public.git
```

Model 包提供 Studio 和工程投影使用的 `@hypit/minimax-h3@1#minimax-h3` 契约；Provider 将该
capability 映射到 API。Provider 通过 `prepare` 脚本在安装时构建，因此 Git 安装不要求 npm
registry 中已有同名发行版。

## 运行配置

```bash
npx hypit-provider-minimax-h3-setup
```

该命令会：

- 在没有配置时创建起始 `hypit.runtime.json`；
- 合并 H3 Endpoint 和 capability binding，同时保留无关 Endpoint、Credential Store 和 binding；
- 只记录凭据引用，不记录 API key；
- 启动 `hypit auth login minimax-h3.selfhosted`，由 Hypit 安全询问并存储 key。

使用 `--no-login` 可只配置不登录。使用 `--help` 查看自定义 Endpoint 名、API base URL、
`resultOrigins` 和模型选择。setup 命令不接受 key 参数、环境变量或 key 文件。

## 手动配置

将下面的 Provider `use` 值合并进已有 `hypit.runtime.json`，不要覆盖无关 Endpoint 或 binding：

```json
{
  "format": "hypit.runtime-local@1",
  "dataRoot": ".hypit/runtimes/local",
  "credentials": {
    "local": {
      "use": "@hypit/credential-store-local"
    }
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

`apiKey` 是 credential reference，不是 secret。`resultOrigins` 只能使用精确 HTTPS origin，
不能包含凭据、路径、query 或 fragment；只需在媒体 CDN 不使用 API gateway `/media/` 路径时配置。

## 安全检查

```bash
hypit auth status minimax-h3.selfhosted
hypit doctor --endpoint minimax-h3.selfhosted
hypit plan productions/example/example.svrun
```

`auth status` 只报告凭据是否存在，`doctor` 执行有边界的连接诊断。它们不会提交生成任务。

## 支持的请求子集

| Hypit port | Open V2 content | 上限 |
| --- | --- | --- |
| `prompt` | `text` | 7,000 字符 |
| `referenceImage` | `reference_image` | 6 张 |
| `referenceAudio` | `reference_audio` | 3 段 |

`duration`、`resolution` 和 `aspectRatio` 如果出现，只接受单值。`resolution` 为必填。

| 服务模型 | 时长 | 分辨率 |
| --- | --- | --- |
| `MiniMax-H3` | 4-15 秒 | `768P` 或 `2K` |
| `MiniMax-H3-Max` | 5-15 秒 | `480P` 或 `768P` |

支持 `9:16` 和 `16:9`。参考音频至少需要一个参考图片。该 gateway 子集会在上传或提交前拒绝
`referenceVideo`、`firstFrame`、`lastFrame` 和未知 port。

## 已知参考素材限制

当前 gateway 的 `POST /v1/assets` 可能只返回 asset ID 而不返回 `/media/` URL，但 Open V2
提交需要 media URL。出现这种情况时，Provider 会以 `MINIMAX_H3_ASSET_URL_MISSING` 失败，不会
猜测 URL。纯文字生成不受影响；参考图片/音频生成需要部署返回可用 media URL，或提供基于 asset ID
的已认证查询方式。

## HTTP 契约

```text
POST   {baseUrl}/v1/assets?projectId=...
POST   {baseUrl}/v2/video_generation
GET    {baseUrl}/v2/query/video_generation/{task_id}
DELETE {baseUrl}/v2/video_generation/{task_id}
```

访问服务的请求使用 `Authorization: Bearer <apiKey>`。结果下载不会发送 API key。

默认服务地址为 `https://app.getcheapvideo.com/api/v1/open`。只有完整请求和响应协议匹配该
Open V2 adapter 时，才能通过 `baseUrl` 切换到其他部署。

## 开发与测试

```bash
npm ci
npm test
npm run build
npm pack --dry-run
```

测试使用本地 fake HTTP 服务，不需要 API key，也不会提交付费生成请求。

## 许可证

MIT，见 [LICENSE](LICENSE)。安全问题报告方式见 [SECURITY.md](SECURITY.md)。
