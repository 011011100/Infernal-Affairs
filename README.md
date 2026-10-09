# 无间风云 · 线上牌局

4～8 人的中文实时房间桌游。手机或电脑打开同一个地址，创建房间并分享房间码即可参与。支持表情，不申请麦克风或摄像头权限。

## 已实现

- 昵称和头像加入、4～8 人容量、准备、仅房主开始、移出等待中的玩家、房主离线转移。
- 服务端发牌和规则结算，调查、拿枪、拿装备、射击、瞄准、经典 16 种装备、胜负揭牌及再来一局。
- 每位玩家独立的身份/装备视图；调查结果只交给调查者，不把隐藏底牌发到其他客户端。
- WebSocket 推送、自动重连、重复操作去重、版本冲突检查、表情频率限制。
- SQLite 持久化对局；刷新或服务重启后，使用原浏览器中保存的身份令牌重连。
- 射击留 6 秒装备响应时间；离线玩家阻塞操作满 60 秒，房主可跳过等待。

规则以经典 16 张装备为基础，采用出版商后续修订卡效，并包含明确的线上时序适配。版本区别和来源见 [规则说明](docs/rules.md)。这不是扩展合集。

## 本地开发

需要 Node.js 24 及以上。

```sh
npm ci
cp .env.example .env
npm run dev
```

打开 `http://localhost:8080`。一个进程提供前端、API 和游戏 WebSocket，无需再启动一份前端项目。开发热更新额外监听 `PORT + 1`（默认 8081，可用 `HMR_PORT` 修改）；生产部署只需一个 HTTP 端口。

```sh
npm test
npm run build
npm start
```

`npm start` 用于已经构建的生产服务；生产进程只依赖打包产物及正式依赖。

## Zeabur 部署

1. 从 GitHub 导入 `011011100/Infernal-Affairs`，根目录使用仓库根目录。Zeabur 自动识别根目录的 Dockerfile。
2. 服务保持 **1 个实例**。前后端共用一个 HTTP 端口，Docker 默认 `8080`，服务会读取 Zeabur 注入的 `PORT`。
3. 添加持久化存储，挂载到 **`/data`**。`DATA_DIR=/data` 已在 Dockerfile 配置。数据库文件为 `/data/rooms.sqlite`。
4. 绑定域名，打开网页即可创建房间。WebSocket 使用当前域名的 `/ws`，无需另开端口。
5. 可选设置 `PUBLIC_ORIGIN=https://你的域名`，精确限制浏览器来源；不要带结尾斜杠。默认按请求主机校验。

无需 PostgreSQL、Redis 或其他外部服务。单实例是当前房间调度与 WebSocket 广播的前提；多副本部署需要改为共享存储、跨实例广播及分布式锁。

**必须挂载 `/data` 才能保证重新部署后保留房间。** 数据卷不会替代备份。房间连续 24 小时无活动且所有人离线后会被清理；浏览器清除本地存储后无法恢复原玩家身份。

健康检查：`GET /api/health`，正常返回 `{"ok":true,"version":"1.0.0"}`。

部署后可执行真实四人联机验收（会创建一个测试房间，完成对局后清理该房间）：

```sh
node scripts/smoke-online.mjs https://你的游戏域名
```

此脚本验证身份隔离、四条鉴权 WebSocket、表情同步、完整首领击败及终局揭牌。它不替代浏览器中的交互检查。

Zeabur 官方说明：[Dockerfile 部署](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)、[端口配置](https://zeabur.com/docs/en-US/deploy/networking/public-networking)、[持久化存储](https://zeabur.com/docs/en-US/operations/data/volumes)。

## 代码结构

| 路径              | 用途                                 |
| ----------------- | ------------------------------------ |
| `src/`            | React 中文界面和联机客户端           |
| `shared/`         | 协议类型、装备资料                   |
| `server/game.ts`  | 纯规则引擎与独立玩家视图             |
| `server/rooms.ts` | 房间权限、连接、版本检查和广播       |
| `server/store.ts` | SQLite 对局快照                      |
| `server/app.ts`   | HTTP / WebSocket 接口                |
| `tests/`          | 游戏规则、多玩家隔离、并发及恢复测试 |

服务器只接受经过验证的动作，在响应和广播前分别生成每个玩家可见的内容。客户端不能指定身份、抽牌结果或胜负。局内关闭页面会保留座位；淘汰后暂时禁发表情，避免影响仍在进行的对局。
