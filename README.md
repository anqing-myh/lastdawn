# 末日黎明 · Last Dawn

浏览器双人联机回合制卡牌游戏，双方各操控两名角色。当前包含34名角色，支持游客大厅、创建和加入房间、角色轮选、对战结算回放及断线重连。

## 运行环境

- Node.js 22.12或更新版本，以及随附的npm。
- 支持现代JavaScript和WebSocket的浏览器。
- 所有玩家连接同一游戏服务。

## 本地运行

在项目根目录执行：

```sh
npm install
npm run dev
```

首次安装生成的 `package-lock.json` 建议随代码提交，后续可使用 `npm ci` 按锁定版本安装。

浏览器打开 `http://localhost:3000`。Windows PowerShell若限制运行npm脚本，可将命令中的 `npm` 替换为 `npm.cmd`。

本机双人测试请使用普通窗口和无痕窗口，或两种浏览器。直接复制标签页可能复制游客令牌，导致新连接接管旧连接。

## 构建后运行

```sh
npm install
npm run build
npm start
```

默认地址为 `http://localhost:3000`。构建产物在本机生成，不需提交到GitHub。运行时通过自带加载器读取TypeScript服务端，因此安装依赖时请保留devDependencies；不要使用 `npm install --omit=dev`。

## 联机与模式

1. 创建房间并选择模式，另一位玩家从大厅或通过房间号加入。默认快速模式。
2. 双方准备后轮选角色，次序为A选1名、B选2名、A再选1名。
3. 快速模式跳过技能与通用特性配置，携带全部六个角色技能及撞击、蓄力；角色专属特性仍生效。
4. 对决模式为每名角色从六个技能中选择四个，并选择通用特性；拥有锁定专属特性的角色使用自己的专属特性。
5. 每回合为能够行动的己方存活角色选择技能与目标，锁定提交后按优先级与速度结算。部分效果会触发15秒即时响应窗口。
6. 结算记录可展开查看伤害明细，每位玩家可独立切换1倍或2倍播放速度。

同一局域网的另一台设备可访问运行电脑的局域网IP及3000端口，需允许对应入站连接。上传代码到GitHub本身不会启动游戏服务；本项目联机需要Node.js服务端，不能仅用GitHub Pages运行完整游戏。

## 配置

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP和WebSocket共用端口 |
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `TURN_TIMER_ENABLED` | 默认关闭 | 设置为 `true` 时新房间默认开启常规行动计时；房主可在准备阶段切换 |

PowerShell示例：

```powershell
$env:PORT='3001'
npm.cmd run dev
```

房间及游客会话保存在单进程内存中，服务重启会丢失；当前无账号、自动匹配或战绩数据库。

## 目录

```text
src/                         页面、共享规则和运行数据
server/                      HTTP、WebSocket与房间管理
assets/images/characters/
  manifest.json              角色与形态清单
  web/                       网页使用的WebP图片
scripts/
  dev.mjs                    开发及生产服务入口
  register.mjs               TypeScript加载器注册
  loader.mjs                 TypeScript与JSON加载器
docs/characters.md           已审核的角色设定与技能描述
docs/github-upload.md        公开上传步骤
```

运行数据以 `src/data/` 为入口；角色技能文案见 [角色设定](docs/characters.md)，特性描述见 `src/data/talents.json`，游戏内提供战斗指南。角色文档中引用的历史机制文件未包含在此精简仓库。

公开版本只保留运行和构建所需文件、网页插画及上述说明；原始图片、提示词、设计草稿、测试脚本、本机连接配置和密钥不在本仓库。
