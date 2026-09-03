# Task

## Current status

Stage 1 in progress：中央计划、对话/worktree mapping 与 ownership 已建立；P0 子代理已完成，A-D 四条实施 lane 正在执行。

## Checklist

- [ ] Lane A — Runtime performance：Charts data/summary 与 renderer 解耦，Chart.js intent-lazy，保持现有结果语义。Thread `01a0656a-96b3-7040-9912-e9de5c0c69fc`；worktree `9410`。
- [ ] Lane B — Tests/CI：迁移源码顺序断言，测试 lane 分类，PR/coverage 重复执行精简。实施 thread `01a0656b-0c95-7723-ade7-6d9c345b0388`；worktree `3e1b`；wrapper `01a0656a-9642-7223-9747-1d7efefe6495`。
- [ ] Lane C — UI/state/Diary：radius policy、Panel/Diary/store facade-preserving 拆分、Diary 评分/Ajv 延迟加载。Thread `01a0656a-a44c-7543-babe-88d886814a1b`；worktree `11eb`。
- [ ] Lane D — Route contracts：compatibility barrel 下拆分 contracts，收口重复 validator support，保持版本化输出。Thread `01a0656a-a577-7763-85da-5485dce570df`；worktree `251f`。
- [x] Subagent P0 — Diary lazy loader rejected Promise 可重试，并增加 focused behavior test。
- [ ] 每条 lane 完成后由唯一 owner 运行约定 focused tests。
- [ ] `/root` 复核交付、计算路径交集并串行整合。
- [ ] 统一候选 fresh manifest/bundle、lint 与 targeted aggregate 通过。

## Validation evidence

| Command or check | Result |
| --- | --- |
| Baseline `git rev-parse HEAD` | `4d5c34cf13fbc8e426347661db5cda988477d82a` |
| Initial static import graph | 0 cycles |
| Existing-dist `node scripts/tests/bundle_policy.mjs` | PASS；不是 fresh build |
| `node --test scripts/tests/mode_ui_contracts.mjs` | exit 0；23/23 PASS（P0 Diary retry） |

## Open risks and remaining work

- A-D 真实 thread/worktree mapping 已登记；B wrapper 额外创建了独立实施 thread，根任务只监督实施 thread，避免重复编辑。
- 当前分支不是 local/remote main；本轮只针对用户刚审计的当前基线实现，不隐式迁移到其他分支。
- CI 实际节省时间、Charts/Diary 用户侧延迟必须在整合候选上重新测量，不能从静态结构直接当作已实现收益。
