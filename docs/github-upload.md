# 在项目根目录维护GitHub仓库

当前直接使用开发目录 `D:\pkm`，远程仓库为 https://github.com/anqing-myh/lastdawn 。现有提交历史、`main` 分支和 `origin` 已保留，无需重新初始化或重复添加远程地址。

## 文件范围

公开游戏源码、运行脚本、依赖清单、构建配置、网页图片和正式文档。根目录 `.gitignore` 排除测试、草稿、原始图片、提示词、日志、依赖目录、构建产物和本地凭据；这些内容仍可保留在本机开发使用。

角色设定直接跟踪 `handoff/03-角色设定.md`，机制与全局配置分别位于同目录的02、04号文档。文档无需另行复制。

## 检查与提交

日常直接在 `D:\pkm` 修改和测试游戏。只有作者明确要求更新GitHub时，再执行以下步骤：

```powershell
Set-Location 'D:\pkm'
git status --short --untracked-files=all
npm.cmd run check
npm.cmd run build
git add .
git diff --cached --name-only
git diff --cached --stat
git diff --cached --check
```

检查完整暂存清单，确认没有本地凭据、测试、草稿、原始图片、日志、依赖或构建产物。也可用 `git diff --cached` 查看文本改动。`.gitignore` 不会自动取消已经被跟踪的文件，应以实际暂存清单为准。

确认改动后提交、推送：

```powershell
git commit -m 'Update game content'
git push origin main
```

`git add` 只暂存内容，`git commit` 记录本地版本，`git push` 才会更新GitHub。暂存后再次修改文件，需要重新暂存相应文件。无需为每次本地调整提交，也无需维护另一份快照。

## 验证公开版本可运行

可以在另一个空目录克隆仓库后验证：

```sh
git clone https://github.com/anqing-myh/lastdawn.git
cd lastdawn
npm ci
npm run check
npm run build
npm start
```

打开 http://localhost:3000 。运行时通过加载器读取 TypeScript，安装依赖时需要保留 devDependencies。公开仓库未包含本地测试和辅助脚本，运行游戏使用 `dev`、`build`、`start`、`check` 命令。

## 仓库与部署

保留当前项目根目录的 `.git`，其中保存提交历史和远程设置。测试、草稿和原始素材按本地开发用途保留。

提交GitHub与部署服务器是独立操作。公网部署等待作者另行明确安排。
