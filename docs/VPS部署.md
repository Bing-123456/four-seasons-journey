# VPS 部署

目标为 SSH 别名 `maker-camp`（60.204.231.189）。接口地址为 `https://guayouji.orionsheep.com`。微信客户端可在「我的」保存该地址；正式客户端还需在微信后台配置 `https://demo.orionsheep.com` 请求域名。

在项目根目录配置 `.env` 后执行：

```sh
bash scripts/deploy-vps.sh
```

脚本上传当前工作区的 `server`、`miniprogram` 和 `package.json`；前端资料与规则也是服务端依赖。不会上传 `.git`、本机缓存或 `node_modules`。`.env` 单独通过 SSH 标准输入传输，服务器生成管理令牌并保留旧令牌，不输出密钥。环境文件只对服务用户可读，权限为 600。后续同步继续运行同一命令。

服务器使用以下独立资源：

- `/opt/guayouji/releases/<发布编号>`：每次发布的代码快照。
- `/opt/guayouji/current`：当前发布链接。
- `/opt/guayouji/shared/.env`：服务配置与密钥。
- `/opt/guayouji/deployments/<发布编号>`：发布前的配置与链接备份，仅 root 可读。
- `guayouji.service`：以独立 `guayouji` 用户运行，监听 `127.0.0.1:8787`。
- `/etc/nginx/snippets/guayouji.conf`：仅由 `demo.orionsheep.com` 的 HTTPS server 引用，匹配 `/guayouji/`。

每次发布先备份服务配置、环境配置、nginx 配置和旧发布链接。服务启动、nginx 校验或健康检查失败时会恢复发布前状态。代码验证仍需在本地先运行 `npm test` 和 `npm run check`；脚本只检查启动、HTTPS 健康状态及匿名 POST 被拒绝，不把这些检查当成真实模型调用成功。

手动回滚本次发布，使用脚本最后打印的发布编号：

```sh
bash scripts/deploy-vps.sh --rollback 20260925T000000Z-12345
```

回滚会恢复该次发布前的代码、环境与服务配置。首次发布回滚会移除新增反代和服务；代码快照和备份保留以便检查。只回滚最近一次发布，避免覆盖后续对同一 nginx 文件做出的调整。

只读检查：

```sh
ssh maker-camp 'systemctl is-active guayouji; nginx -t'
curl --fail https://guayouji.orionsheep.com/health
```

公开健康检查应显示 `auth.required: true`、`auth.authenticated: false`。健康检查的 `not-checked` 只表示尚未实测供应商。首次启动和每次重启都会清空短期开发会话，需重新配对；配对码仅可在服务器日志中查看，不要把包含配对码的日志公开粘贴。

当前服务使用开发配对鉴权，不等同于正式微信用户登录。真实供应商验收要分别检查文本、图像识别、伙伴图片和水墨画任务，并确认成功结果确实来自云端。

读取最新开发配对码（5 分钟有效、一次性使用）：

```sh
ssh maker-camp 'journalctl -u guayouji -n 30 --no-pager'
```

只在自己的终端查看，不公开日志。若配对码过期，在小程序提交后服务会生成新码，再读取日志即可。

真实接口验收（会使用模型和图片供应商额度；报告不含密钥）：

```sh
ssh maker-camp 'cd /opt/guayouji/current && SMOKE_REPORT=/tmp/guayouji-smoke.json node - https://guayouji.orionsheep.com --server-env' < scripts/smoke-service.js
```

图片下载需将供应商返回的实际结果域名配置为微信 `downloadFile` 合法域名。开发者工具的跳过域名校验不代表手机正式环境已完成配置。
