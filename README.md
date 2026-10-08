# xiaokai × Kie.ai 后端 V1

## 本地积分测试版

- 画布右上角显示可用积分，点击可查看价格和流水。
- 提交生成时先冻结积分；成功扣除，失败自动返还。
- 当前默认测试价格：GPT Image 2 每张 20；Nano Banana 2 的 1K/2K/4K 分别为 15/25/40。
- 价格可在 `.env` 中通过 `PRICE_*` 项修改。
- 需要增加测试余额时，关闭画布服务后双击外层的 `添加测试积分.bat`。
- 这是单机测试钱包。正式销售前必须迁移到带登录和数据库的云端，且不要把“添加测试积分”工具发给普通用户。

这一版把 Kie API Key 从前端 HTML 中彻底移到后端 `.env`，并打通第一条真实生图链路。

## 已接入

- GPT Image 2：文生图；连接上游图片时自动切到图生图。
- Nano Banana 2：文生图 / 参考图生图。
- 本地图片 Data URL 自动通过 Kie Base64 File Upload 上传，再作为参考图传给模型。
- 真实 Kie 任务：创建任务 → 轮询状态 → 成功/失败。
- 生成成功后把远程图片缓存到本地 `generated/`，避免画布只依赖临时远程 URL。
- 前端任务队列继续显示等待 / 上传中 / 生成中 / 成功 / 失败 / 已取消。
- 生成数量 1–8：后端会创建对应数量的 Kie 任务。
- API Key 不进入浏览器、不进入 HTML。
- 画布项目、素材库、Skill 库和快照按登录账号保存到服务端；同一账号换电脑登录后可恢复。

## 第一次运行（Windows）

1. 双击 `start.bat`。
2. 第一次会自动生成 `.env` 并打开记事本。
3. 只填写：

   `KIE_API_KEY=你的真实Kie密钥`

4. 保存 `.env`，关闭记事本。
5. 再次双击 `start.bat`。
6. 浏览器打开：`http://127.0.0.1:4318`
7. 生图节点选择 `GPT Image 2` 或 `Nano Banana 2`，输入 Prompt 后运行。

## 先测试密钥/积分是否正常

启动后浏览器访问：

- `http://127.0.0.1:4318/api/health`
- `http://127.0.0.1:4318/api/credits`

`/api/credits` 能返回 Kie 积分，说明 Key 和后端连接正常。

## 当前 V1 的重要说明

Kie 当前公开的 GPT Image 2 文档示例公开了 `prompt` 与 `aspect_ratio`，但没有公开 `resolution` 请求字段。因此这版对 GPT Image 2 不强行发送 2K / 4K 参数；Nano Banana 2 会正常发送 `resolution`。后续如果你决定切到 GPT Image 2.5 Flare/Sunburst，可以扩展 Model Router 来获得明确的 1K/2K/4K 控制。

本地“取消”只停止 xiaokai 继续等待结果；如果 Kie 任务已经提交，供应商侧任务可能仍会继续运行并产生费用。正式商业版需要再根据供应商是否提供取消接口做更严格的处理。

## 后端结构

```text
public/index.html
      ↓
POST /api/image/generate
      ↓
src/model-router.js
      ↓
src/providers/kie.js
      ↓
Kie createTask
      ↓
GET /api/task/:taskId
      ↓
Kie recordInfo
      ↓
generated/ 本地缓存
```

后续增加 Seedream 官方、fal、PiAPI 时，只新增 provider adapter，不需要重写画布。

## V1.1 修复

- 修复：在生图节点里切换模型后，节点仍使用上一次模型参数的问题。
- 当前 Kie 真实后端已接入 `GPT Image 2` 与 `Nano Banana 2`；其他模型在菜单中保留但会显示“未接入”，避免误提交。
- 如果任务队列里已有旧的 `Nano Banana Pro` 失败任务，请清空队列或重新选择 `Nano Banana 2` 后新建任务。


## V1.2 模型选择修复

- 普通“运行”任务以当前面板可见模型为唯一准则，不再读取旧节点残留的模型名。
- 旧任务若锁定了尚未接入的 Nano Banana Pro 等模型，重试时会自动迁移到当前已接入模型。
- 目前真实 Kie 模型仍为 `GPT Image 2` 与 `Nano Banana 2`。
