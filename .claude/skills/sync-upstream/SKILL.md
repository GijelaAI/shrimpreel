---
name: sync-upstream
description: 在 ShrimpReel 派生出的站点仓库里合并模板（upstream）的更新：先出同步计划，再 git merge，按“共用代码取模板、站点层保留站点的值”的分层策略解决冲突，列出新增的 vars、密钥和迁移，最后验证。用户说“同步模板”“合并 upstream”“更新模板”“sync upstream”时使用。
---

# 合并模板更新

目标：把 `upstream/main` 合进站点仓库。模板的修复全部进来，站点自己的配置和文案不丢，最后列出部署前必须做的事。不提交、不推送、不部署，除非用户明确要求。

## 前提（不满足就停下说明）

1. 当前目录是站点仓库：`git remote -v` 里有 `upstream` 指向模板。当前仓库就是模板时不适用。
2. 工作区干净（`git status --short` 为空），也没有进行中的合并（`.git/MERGE_HEAD` 不存在）。
3. 已 `npm install`。

站点里可能还没有这个 skill（第一次同步）。这时用 `git show upstream/main:.claude/skills/sync-upstream/SKILL.md` 读模板里的版本照做。Windows 的 Git Bash 会把 `<ref>:<路径>` 当成路径列表改写，`git show` 报 `ambiguous argument`，前面加 `MSYS_NO_PATHCONV=1`。

## 1. 出同步计划

```bash
mkdir -p .tmp/sync-upstream
git fetch upstream
git show upstream/main:scripts/sync-plan.mjs > .tmp/sync-upstream/sync-plan.mjs
node .tmp/sync-upstream/sync-plan.mjs | tee .tmp/sync-upstream/plan.log
```

用模板最新版的脚本，分层规则以模板为准，站点里有没有这个脚本都能跑。输出“已经是最新”就结束。

- 基线是 `git merge-base HEAD upstream/main`，所以只能用 `git merge`。squash、rebase 或 cherry-pick 模板提交都会让基线停在原地，下次计划会重复列出已合过的提交。
- “站点改过的共用文件”不为空时，逐个看 `git diff <基线> HEAD -- <文件>`，归成三类告诉用户：
  1. 模板已经有同样或更好的修复：合并时取模板版本。
  2. 站点特有的需求（比如改了 `src/styles.css` 的主色）：保留站点改动，写进最终汇报，建议以后在模板里做成站点层配置。
  3. 站点上修的共用 bug：合并时保留，建议回到模板修一次，再合并到各站。

  判断不了属于哪类时停下问用户。保留下来的站点改动以后每次出计划都会再列出来，对照上次的汇报确认没有新增即可。

## 2. 合并

```bash
git merge --no-ff --no-commit upstream/main
git status --short
```

按计划里每个文件的层处理冲突：

| 层 | 处理 |
| --- | --- |
| 共用代码 | `git checkout --theirs -- <文件>`。站点改过的共用文件按第 1 步的结论处理 |
| 站点层（`site.ts`、`src/content/*`、`public/*`、`seed/`、`wrangler.jsonc`、`package.json`） | 手工合并：保留站点的值（品牌、关键词、域名、价格、文案、资源名和 id、vars 的值），接受模板新增的键、字段、函数和类型。`package.json` 只保留站点的 `name`。站点换过的图片和视频冲突时保留站点的（`git checkout --ours`） |
| 站点已删除（`wrangler.staging.jsonc`） | `git rm wrangler.staging.jsonc` |
| 依赖锁（`package-lock.json`） | `git checkout --theirs -- package-lock.json`，然后 `npm install`，再 `git add package-lock.json` |

没有冲突、自动合并的站点层文件也要看：`git diff HEAD -- src/content src/config/site.ts`。模板新增或改动的文案按站点的关键词和语气改写，不要把模板的示例主题带进来；`zh.ts` 缺键时 typecheck 会报错。

解决完一个文件就 `git add`，最后 `git diff --name-only --diff-filter=U` 应该为空，`git grep -n -e '^<<<<<<< ' -e '^>>>>>>> '` 没有结果。

## 3. 补配置

- 新增 vars：键已经随 `wrangler.jsonc` 合进来，值是模板的默认值。对照 `docs/env.md` 判断站点要不要改；上线才需要的值写进最终汇报。
- 新增密钥：本地按 `.dev.vars.example` 补进 `.dev.vars`（只写键名和占位值，不要打印已有的密钥）；线上的 `wrangler secret put` 写进最终汇报，由用户做。
- 新 migration：本地 `npm run db:migrate:local`；线上的 `npm run db:migrate:remote` 写进最终汇报。

## 4. 验证

依次运行，输出存到 `.tmp/sync-upstream/`：

```bash
npm run typecheck
npm test
npm run build
npm run seed:local     # 应用本地迁移、上传模板源视频
npm run test:e2e       # 端口被占用时 E2E_PORT=<端口> npm run test:e2e
npm run seo:check      # 另开 dev server；文案有改动时必跑
```

e2e 的 global-setup 按默认风格的 `site.styles[0].sources`（第一个档位）检查本地 R2 里的源视频，报 404 时先看 `seed/templates/` 的文件名和 `site.styles[].sources` 是否一致，这是站点层的问题。

失败先修。修法要符合分层：共用代码的失败说明合并取错了版本或模板本身有 bug（后者停下告诉用户，回模板修）；站点层的失败在站点文件里修。

## 5. 汇报

1. 基线 → 目标（短 sha）和模板新提交数。
2. 冲突文件和每个的处理方式；保留下来的站点改动（第 1 步的第 2、3 类）。
3. 新增的 vars、密钥、迁移，以及第 3 步本地已经做了什么。
4. 验证结果：每条命令是否通过。
5. 部署前用户要做的事：`npm run db:migrate:remote`、`wrangler secret put` 新密钥、改 vars 的生产值、`npm run deploy`、`SMOKE_BASE_URL=https://<域名> npm run test:smoke`。

合并结果停在暂存区，等用户确认后再提交。提交信息：

```text
Merge template updates up to <短 sha>

Template-sync: <完整 sha>
```

`git log --grep "Template-sync:"` 可以查历次同步。用户要放弃这次合并时用 `git merge --abort`，它会丢掉所有冲突处理结果，执行前先确认。
