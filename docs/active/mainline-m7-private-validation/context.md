# Context

## Current truth

- Worktree：`C:/Users/raede/.codex/worktrees/5326/engagement_project`。
- Branch：`codex/mainline-m7-private-validation`；初始 base 与当前 merge-base 为
  `dfb4bc8a8a02e211e4fb212db847487c9970318a`；创建分支前 tracked/untracked status 为空。实现期间外部
  owner 已把本地 `main` 前移到 `2a4a6a3205b28cfca6c1f374065d5556d0e21531`；本 lane 未 rebase、merge 或改写 main。
- 当前 lane 是唯一 integration owner，可操作本任务 branch/index/commits，但无 main merge、push、deploy、
  远端 mutation 或其他 worktree 清理权限。
- 所有产品代码限定在 `src/route_generation/local_companion/**`，执行/验证代码限定在
  `scripts/local_route_companion/**`、M7 fixtures/schema/validators/focused tests 与本 task record。
- `docs/active/_worktree_registry.md` 只读；公开路线 UI、global style/i18n、ML、README、registry、release 不改。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-09-01 | `HEAD=main=merge-base=dfb4bc8…`，工作树初始干净且 detached。 | 创建独立 `codex/mainline-m7-private-validation`，不触碰 main owner。 |
| 2026-09-01 | 用户明确要求 repo-native `plan/context/task`；`manage-task-records` 适用。 | 本任务只维护这一组 active records，未完成的人工 QA 使其保持 active。 |
| 2026-09-01 | M6 gate 仍将缺证据状态机械输出为 `NO-GO/UNAVAILABLE`，并禁止生成 route output keys。 | M7 只能在本地运行时逐维生成 authority-neutral observation；缺口继续 fail closed。 |
| 2026-09-01 | M6 privacy closeout 的可复用边界是私人数据不进 URL/storage/network，且 candidate/OSRM request 计数为零。 | M7 新增的本地请求必须限制为 loopback body transport，并单独机械计数为零 egress。 |
| 2026-09-01 | 三个只读 explorer 分别映射 route runtime、privacy/evidence 和 validation pack。 | 主任务独占实现、Git 和 live processes；子任务不修改代码或 refs。 |
| 2026-09-01 | 第一轮 diff/security review 证明原 runner 信任 companion 自报 identities/egress，QA 只靠计数即可完成。 | 改为真实 companion bridge、runner-owned identity/attempt observation、无 OS proof 强制 unavailable、逐样本 QA artifacts。 |
| 2026-09-01 | Node async-hooks/fetch 只能探测 Node 层 escape attempt，不能证明 native/OS 层无外联。 | Formal available 明确要求独立 OS outbound-deny observation；当前 runner 没有该证据，只能 mint unavailable receipt。 |
| 2026-09-01 | 最终 review 发现 self-reported observer SHA、coverage denominator、QA route universe 与 threshold baseline provenance 仍可伪造。 | benchmark available 在 verifier contract 存在前完全关闭；threshold/QA 要求 admitted benchmark；coverage 绑定 trusted evidence artifact、route topology、完整有序 edge sequence 与唯一 covered subset。 |
| 2026-09-01 | OSRM native HTTP 文档把坐标放入 GET path。 | M7 只提供 in-process Node/libOSRM seam；不调用 native OSRM HTTP GET。 |
| 2026-09-01 | `osrm-routed`、exact Philadelphia graph、真实 evidence artifacts 均未在 worktree/PATH 观察到。 | baseline=`unavailable`；threshold 不冻结；不下载、不用 synthetic 结果冒充正式 baseline。 |
| 2026-09-01 | 安全复核证明旧 `route --port` 会在身份验证前向任意 loopback listener 发送私人 body。 | `route` 现在只信任自己 fork 的 child；256-bit env secret 不进入 argv/URL/ready/output/body，先完成无坐标 HMAC challenge，再发送一次性 body-bound proof。bind/ready/proof 失败均不发送私人 body。 |
| 2026-09-01 | 任意绝对 `adapterModule` 路径会在 export shape 校验前执行动态 import，路径字符串检查无法证明代码来源。 | 删除 filesystem dynamic import；CLI、service、PowerShell 与 API alias 均拒绝 external module。保留 built-in unavailable 与受信 same-process companion seam。 |
| 2026-09-01 | 最终 gate：M7 51/51、adjacent 28/28、scoped ESLint、PowerShell parser、Ajv 7/7 均 PASS；稳定补丁独立只读 review PASS。 | 当前 lane 可交回；这些检查不替代真实 OSRM、OS deny observation、人工 QA、full validate 或远端 CI。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| none | `/root` | n/a | focused lifecycle 测试进程均已退出；未启动真实 OSRM、长 benchmark 或共享 listener。 |

## Handoff

最终交回总协调任务：先整合 runtime commit
`67eceed1c2387e60cb0dd52abd364b5f6ca037f7`，再整合 validation commit
`5e546a46f618e8366cc2ea1d1ff241ed633a4e67`，然后 handoff-record commit
`083e79710bd12313e27b260d26037c50f64f6e56`，最后整合本 branch HEAD 的安全追加提交。当前本地 `main`
已经由外部 owner 前移至 `2a4a6a3205b28cfca6c1f374065d5556d0e21531`，本 lane 没有 rebase、merge 或 push。

## Next step

由总协调任务按上述顺序整合并处理其 `m7-product-closeout` records；之后只有在取得 exact engine/graph、
verifier-bound OS outbound-deny artifact 和两名独立人工 reviewer 记录时，才可另行运行正式 baseline 与
开启 threshold/QA admission。当前不应宣称 promotion、production serving 或部署。
