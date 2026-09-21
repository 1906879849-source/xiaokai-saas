# Railway 部署说明（xiaokai SaaS V1）

本目录已经适配 Railway：

- 监听 Railway 自动注入的 `PORT`
- 服务绑定 `0.0.0.0`
- `npm start` 直接启动
- 健康检查可使用 `/api/health`
- Kie Key 只通过 Railway Variables 配置，不写进代码

## 必填 Railway Variables

```env
KIE_API_KEY=你的Kie密钥
NODE_ENV=production
ADMIN_EMAIL=你的管理员登录邮箱
ENABLE_DEV_TOPUP=true
```

`ENABLE_DEV_TOPUP=true` 时，生产环境只有 `ADMIN_EMAIL` 对应的管理员账号可以使用测试充值；普通用户不能免费加积分。

## 可选 Variables

```env
KIE_API_BASE_URL=https://api.kie.ai
KIE_UPLOAD_BASE_URL=https://kieai.redpandaai.co
DATA_DIR=/data
GENERATED_DIR=/data/generated
```

如果 Railway 服务挂载 Volume 到 `/data`，设置上面的 `DATA_DIR` / `GENERATED_DIR` 后，账号、积分、画布 JSON 和生成图片可保存在 Volume 中。

## Railway 设置

- Start Command：`npm start`（通常 Railpack 会自动识别）
- Healthcheck Path：`/api/health`
- Networking：Generate Domain

部署成功后会得到：

`https://<service-name>.up.railway.app`

## 当前 Beta 注意

当前用户/钱包/项目数据库仍是 JSON 文件。正式收费前建议改 PostgreSQL；Railway Volume 适合当前内测，不建议作为长期正式账务数据库。
