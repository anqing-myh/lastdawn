# 将精简版本上传到GitHub

本次准备的公开目录为 `D:\pkm\artifacts\github-public\lastdawn`。它是完整开发目录的独立快照，仅包含运行、构建、网页图片和必要文档。上传它即可，不要把整个 `D:\pkm` 直接拖入公开仓库。

## 一、在GitHub创建空仓库

登录GitHub，选择右上角的“+”→“New repository”，仓库名可用 `lastdawn`，可见性选 `Public`。本地版本已有README和.gitignore，首次创建时不勾选初始化README、.gitignore或许可证。许可证尚未代为选择，可由作者后续决定。

创建后复制仓库页面显示的HTTPS地址。

## 二、从PowerShell提交

```powershell
Set-Location 'D:\pkm\artifacts\github-public\lastdawn'
git init -b main
npm.cmd install
npm.cmd run build
git add .
git status --short
```

检查待提交列表中只有README、.gitignore、package文件、构建配置、src、server、三个运行脚本、WebP素材清单和docs。没有 `.local-secrets`、私钥、`.env`、日志、测试、原始PNG、node_modules或dist。

首次安装会生成 `package-lock.json`，将它一并提交。完整开发环境的旧锁文件由离线缓存恢复，未直接复制到公开目录；请在可正常访问npm的终端完成这一步。

首次使用Git时，如果提交提示缺少身份，在此仓库内设置：

```powershell
git config user.name '你的GitHub显示名'
git config user.email 'GitHub设置页面提供的noreply邮箱'
```

然后提交并推送，把命令中的仓库地址替换成刚才复制的实际地址：

```powershell
git commit -m 'Initial public version of Last Dawn'
git remote add origin '粘贴你的GitHub仓库HTTPS地址'
git push -u origin main
```

首次推送按本机Git凭据管理器的提示登录GitHub。推送完成后，刷新GitHub仓库页面检查README、代码和图片目录。这里仅上传代码，不执行任何服务器部署。

## 三、验证别人能够运行

在另一个空目录克隆仓库后运行：

```sh
git clone 你的仓库HTTPS地址
cd lastdawn
npm install
npm run build
npm start
```

打开 `http://localhost:3000`。依赖和构建产物由命令生成，不需要上传。三个scripts文件是服务启动必需文件，不能因为其他测试脚本被排除而一起删除。

## 四、后续更新

此目录是本次的公开快照，后续游戏修改不会自动同步。更新已公开的对应源码、数据、WebP图片和角色文档后，在此目录执行：

```powershell
git status --short
git add .
git commit -m 'Update game content'
git push
```

不要覆盖或删除已经初始化的 `.git`。完整开发目录中的测试、草稿及原始素材继续留作本地开发使用。
