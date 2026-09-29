# Railway 测试版部署清单

## 服务配置

- 部署根目录：本文件所在的项目目录
- 构建方式：Dockerfile（`railway.json` 已配置）
- 健康检查：`/api/health`
- 持久化 Volume 挂载路径：`/app/storage`
- 公网域名：使用 Railway 自动生成的 HTTPS 域名

## 必填环境变量

把 `.env.production.example` 中的配置加入 Railway Variables。其中以下项必须使用真实值：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`（至少 12 位，只存在 Railway）
- `OTTERL_API_KEY`
- `PUBLIC_BASE_URL`（生成 Railway 域名后回填）

`ACCOUNT_SIGNUP_CREDITS=0` 必须保持为 0，新用户不会获得试用积分。

## 上线后验收

1. 打开 `/api/health`，确认 `ok` 为 `true`。
2. 用管理员账号登录 `/admin.html`。
3. 注册一个普通测试账号，确认积分为 0。
4. 提交一笔¥1 充值申请，在管理后台通过，确认到账 100 积分。
5. 运行一次生图，确认失败会返还积分，成功会扣费并显示图片。

## 安全说明

- `.env`、本地账号数据和已生成图片不包含在部署包中。
- 生产环境不再默认把“第一个注册用户”设为管理员，避免公网抢注。
- 账号、积分、充值审核和生成图缓存均依赖 `/app/storage` Volume；不要省略该 Volume。
