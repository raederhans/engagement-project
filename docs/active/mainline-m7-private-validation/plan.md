# Mainline M7 Local Private Mode and Validation

## Goal

从干净 `main@dfb4bc8a8a02e211e4fb212db847487c9970318a` 起步，在当前隔离 worktree
交付 Windows 优先、仅 loopback、无私人路线数据外传的本地 route companion，并建立公开、可复现、
身份绑定且 fail-closed 的 M7 validation pack。当前 lane 可创建本地结构化 commits；main 整合、push、
deploy、远端设置与其他 worktree 清理由总协调任务保留。

## Scope

- 新建 `src/route_generation/local_companion/**`：组合本地 OSRM、bounded candidate generator、
  independent evidence enricher 与 privacy-safe adapter；私人 origin/destination/geometry 只驻留于内存。
- 新建 `scripts/local_route_companion/**`：Windows PowerShell/Node CLI 启停、loopback service、
  process-lifecycle、privacy egress observation 与 validation runner。
- OSRM 不可用时返回明确的 Known Route paste/draw fallback；单候选不伪造 alternatives。
- crime/crash/accessibility/map-match/sensitivity 在身份、覆盖、来源或计算缺失时保持
  `unavailable/partial/ambiguous/unmapped`，不零填、不推断、不合并为 safety score。
- 新建 M7 schema、30-50 个公开 Philadelphia OD fixtures、baseline profile、冻结门槛、正式 receipt、
  validator 与 focused tests。
- 公开 OD 覆盖 Center/West/North/South/Northeast Philadelphia、短中途，以及桥梁、公园、
  大街区、断头路和步行路径边界。
- 人工 100-segment QA 只交付可审计抽样/盲化 reviewer slots/adjudication 结构；没有两名独立人工
  reviewer 的真实记录时，完成状态必须是 `unavailable`。

## Sources of truth

- 当前委派、仓库 `AGENTS.md` 指令与 `docs/AGENTS.md`。
- `main@dfb4bc8…` 的现有 route-generation、route-decision、Known Route、M5/M6、privacy、evidence、
  authority contracts 与 focused tests。
- 当前 worktree 中可直接观察的本地 engine/graph/benchmark receipt；历史或其他 worktree 结果只作线索。
- baseline profile 先于正式性能门槛冻结；不得调整输出或门槛来制造通过结果。

## Stages

- [x] Stage 1: 核验基线、worktree 状态、适用规则与既有 M5/M6 gate。
- [x] Stage 2: 冻结 M7 local companion/privacy/validation contracts 与公开 OD corpus。
- [x] Stage 3: 实现 loopback-only service、PowerShell/CLI lifecycle 和 privacy-unverified adapter 边界。
- [x] Stage 4: 提供 in-process OSRM seam、bounded candidates、independent enrichment 与 Known Route fallback；
  当前机器无真实 engine/graph，因此 runtime 保持 unavailable。
- [x] Stage 5: 运行 no-runtime preflight，生成 identity-bound unavailable baseline；没有真实 baseline 与 OS-level
  outbound-deny 观察，因此正式门槛保持 unavailable/unfrozen。
- [x] Stage 6: 运行最窄充分 unit/privacy/loopback/lifecycle/validator 检查、二轮只读 review 并结构化提交。

## Acceptance criteria

- listener 只能绑定字面量 `127.0.0.1`；非 loopback host 配置、非本地 upstream 与不受控重定向均拒绝。
- origin、destination、坐标、几何和 paste/draw payload 不进入 URL、日志、持久偏好、receipt 或网络。
  receipt 区分 no-runtime、Node attempt detector 与 OS outbound-deny；只有经 verifier-bound artifact 验证的
  最后一种才可在未来支撑 formal available，当前 admission 保持关闭。
  当前 tracked preflight 没有执行 runtime，因此 `egressCount=0`，不冒充真实引擎零外传证明。
- 私人请求 ingress 使用 loopback POST/body seam；OSRM 路由调用使用 in-process binding，避免把坐标编码到
  native HTTP GET path；candidate search 有确定性预算上限和显式 terminal state。
- OSRM 不可达时返回 `known-route-paste-draw-required`，不声称 generation success；一条 canonical route
  的结果明确为 single candidate，不创建虚假 alternatives。
- engine、graph、candidate policy、route 与 evidence identities 写入 validation observation；缺真实
  engine/graph 时生成 `unavailable` receipt，绝不使用相邻或 synthetic 结果冒充。
- validation receipt 计算 generation success、invalid、duplicate、median/p95 latency、map-match distance、
  segment evidence coverage、detour、weight sensitivity 与 privacy egress；validator 严格校验分母和状态。
- baseline profile 与 frozen threshold policy 分离且按内容身份绑定；正式结果不得反向修改 policy。
- crime/crash/accessibility/map-match/sensitivity 的证据覆盖不完整时逐维 fail closed；无 routing、
  safety、scientific、promotion 或 production authority。
- 人工 QA 样本可复现、段级可 adjudicate；没有双人完成证据时不得声明完成或通过。
- 最窄 unit/privacy/loopback/process-lifecycle/benchmark-validator 检查通过；长 OSRM/benchmark 只有
  `/root` 是 live-process owner。

## Non-goals

- hosted backend、云上传、遥测、远程 OSRM、公开路线 UI、global style、i18n、ML、全局 README、
  registry、release 或 deployment。
- 多交通方式、safest route、combined safety score、真实私人 OD corpus 或用户轨迹持久化。
- main merge、push、tag、PR、远端权限/设置 mutation，或其他 branch/worktree 的清理。
- 在没有实际双人复核时完成 100-segment 人工 QA。

## Risks and constraints

- OSRM 常见 GET 路径会把坐标写入 URL；本 lane 只允许可验证的 loopback POST/body adapter，否则 fail closed。
- 现有 public adapter、M5 mathematical core 和 M6 gate 的 authority 边界不能因“local”而被绕过。
- 当前 worktree 可能没有真实 OSRM engine/Philadelphia graph；该缺口应产出 unavailable receipt，而不是
  下载、联网或创建伪造性能证据。
- Windows 进程/端口释放可能受外部监听器影响；测试必须使用独占临时端口、可验证 shutdown 和无遗留 listener。
