# AgenticHRdata 分模块完整搭建指南

> 目标：搭建「前端零配置、后端自适应」的 HR 数据接入系统。核心是 **慢/快链路分离** + **四层安全护栏**。

---

## 全局技术栈总览

| 层 | 技术栈 | 含 LLM |
|---|---|---|
| 前端看板 | 原生 HTML/JS | ❌ |
| SDK 层 | JS，UMD/ESM 打包，挂 `window.AgenticHRdata` | ❌ |
| Agent 服务端 | Node.js + Express/Fastify + 自研 Workflow（后期可迁 LangGraph） | ✅ |
| MCP 服务端 | `@modelcontextprotocol/sdk`（Node.js） | ❌ |
| 沙箱 | `isolated-vm` / Worker / 容器 | — |
| 缓存 | Redis（或文件） | — |
| 校验 | `ajv`（JSON Schema） | — |

---

## 模块一：前端 HTML 看板

**技术栈**：原生 HTML/JS（沿用现有看板，零框架依赖）。

**职责边界**：只做三件事 —— 引入 SDK、触发刷新、把回填数据交给现有渲染逻辑。不理解业务、不碰后端、不改渲染代码。

**不可缺的关键功能**：

1. **引入 SDK**：`<script src="./agentic-hr-data.js"></script>`。
2. **初始化 + 注册 onChange 回调**：数据一变即 `state.rows = rows; renderAll()`，复用现有渲染。
3. **刷新按钮**：新增 `#btnRefresh` → 调 `sdk.refresh(document.documentElement.outerHTML)`，含 loading/禁用态与异常提示。
4. **降级 fallback**：保留 `state.rows = load() || seedRows()` 作为取数失败兜底。

> 关键约束：**渲染层零改动**。`metricData/renderKPI/renderAll` 一律不动，仅由 `onChange` 驱动。

---

## 模块二：SDK 层（AgenticHRdata）

**技术栈**：纯客户端 JS，UMD 风格挂全局 `window.AgenticHRdata`，与 jdmap-gl 同构，`<script>` 即用。**不含大模型。**

**职责**：前端与 Agent 服务端之间的桥 —— 管理共享内存 `_rows`、发起请求、脱敏、广播变更。

**核心 API 契约**：

| 成员 | 签名 | 作用 |
|---|---|---|
| 构造 | `new AgenticHRdata({endpoint, appKey, onChange})` | 初始化 + 注册回调 |
| 刷新 | `refresh(outerHTML): Promise<rows[]>` | 传快照 → 请求 Agent → 回填广播 |
| 读取 | `getRows(): rows[]` | 只读访问共享内存 |
| 自动 | `startAutoRefresh(ms)` / `stopAutoRefresh()` | 可选定时刷新 |

**不可缺的关键功能**：

1. **脱敏（硬要求）**：发送前用 `_sanitize()` 剥离内联 `<script>`，防止 `appKey/Token` 随快照外泄。
2. **请求封装**：`POST` 到 `endpoint`，带 `X-App-Key` 鉴权头，非 2xx 抛错。
3. **共享内存 + 单向广播**：`_rows = rows` 后仅通过 `onChange` 向外广播，**绝不反向操作 DOM**。
4. **快照瘦身（建议）**：整页数百 KB，可只截取 `FIELDS/TABLE_COLS` 定义片段发送，降传输与 Token 成本。

---

## 模块三：Agent 服务端（系统大脑，唯一含 LLM）

**技术栈**：Node.js + Express/Fastify；自研 Step/Workflow 编排（复杂后迁 LangGraph）；LLM 需支持 function-calling；Redis 缓存；`isolated-vm` 沙箱；`ajv` 校验。

**职责**：理解字段、编排 Workflow、调 MCP 取数、生成/执行清洗脚本、返回标准 rows。

**核心：双链路设计**

```
POST /refresh
  1. 计算 HTML 指纹(hash 字段定义片段)
  2. 查缓存 fieldMap + cleanScript
  ├─ 命中(快链路·无 LLM)→ MCP 取数 → 缓存脚本清洗 → 校验 → 返回
  └─ 未命中(慢链路·含 LLM)→ LLM 产 fieldMap+cleanScript → 沙箱校验 → 写缓存 → 转快链路
```

**不可缺的关键功能**：

1. **指纹与缓存查询**：`fingerprint(outerHTML)` 生成 cacheKey，命中即跳过 LLM。
2. **慢链路学习**：`llm.analyzeFields`（看板字段↔Workday 字段映射）+ `llm.genCleanScript`（纯函数 `(raw)=>rows[]`），产物**固化缓存**，日常不再触发。
3. **Workflow 编排**：`cacheKey → cached → learn → fetchRaw(带重试) → clean → validate` 串行流水线，含 `_trace` 链路追踪。
4. **MCP 客户端**：通过 MCP 协议调 `callWorkdayAPI` 取原始数据（fetchRaw 建议 retries=2）。
5. **沙箱执行清洗脚本**：调 `sandbox.run(script, raw)`。
6. **schema 校验输出**：`validateRows(clean, HR_FIELDS_SCHEMA)` 通过才返回。
7. **HTTP 入口**：`/refresh` 返回 `{ rows, trace }`，异常返回 500。

---

## 模块四：MCP 服务端（Workday 能力封装）

**技术栈**：`@modelcontextprotocol/sdk`（Node.js）。**不含大模型。**

**职责**：把 Workday 等外部 API 封装为标准 MCP 能力，供 Agent 统一调用。

| 类型 | 是什么 | 例子 | LLM 用途 |
|---|---|---|---|
| **tool** | 可执行动作 | `callWorkdayAPI(endpoint, params)` | 决定调哪个 API、传什么参数 |
| **resource** | 只读数据描述 | `workday://schema/worker` | 理解返回结构，据此写清洗脚本 |

**不可缺的关键功能**：

1. **tool 注册与调用**：`tools/list` + `tools/call`，`description` 与 `inputSchema` 写清用途和参数含义（LLM 调用的唯一依据）。
2. **鉴权内聚**：`getWorkdayToken()` 封装在 MCP 内部，Workday Token 只存此处，Agent 与前端都拿不到。
3. **resource 暴露 schema**：`resources/list` + `resources/read` 提供各 API 的 JSON Schema，作为「原始数据契约」。
4. **错误处理**：Workday 非 2xx 抛明确错误（含 endpoint 与状态码）。

> 拆分策略：少量 API 用一个参数化 `callWorkdayAPI`；API 众多时按业务拆多个 tool。

---

## 贯穿全局：四层安全护栏（LLM 生成脚本是最大风险点）

| 层 | 护栏 | 位置 | 作用 |
|---|---|---|---|
| ① 输入脱敏 | 剥离 `<script>` | SDK | 防 appKey/Token 外泄 |
| ② 脚本沙箱 | `isolated-vm`/Worker，禁网禁 FS、限内存(64M)/超时(3s) | Agent | 隔离 LLM 脚本 |
| ③ 输出校验 | `ajv` schema 校验 | Agent | 字段/类型不符则拒绝回填 |
| ④ 人工审核 | 首次脚本固化前过目 | Agent | 防恶意/错误脚本进缓存 |

其他要点：鉴权链逐层收敛（前端 appKey → Agent 校验 → MCP 持 Workday Token）；Agent 只放行看板域名的 CORS；记录每次 refresh 的 `_trace` 审计日志；手动 refresh 加防抖/节流。

---

## 推荐落地路线（每步可验证）

| 阶段 | 目标 | 用 LLM | 验收 |
|---|---|---|---|
| **P0** | 手写映射+清洗，SDK 直连 MCP 取数回填 | ❌ | 数据管道跑通，看板显示真实数据 |
| **P1** | 加 Agent 学习环节，自动产字段映射（人工审核） | ✅ 仅学习 | LLM 正确产出映射表 |
| **P2** | 清洗脚本自动生成 + 沙箱 + schema 校验 | ✅ | 沙箱运行，校验拦截错误输出 |
| **P3** | 字段变更感知、缓存失效、多数据源扩展 | ✅ | 慢/快链路闭环，支持多外部系统 |

> **强烈建议 P0 不上大模型**：先用手写映射把 `MCP → Workday → 清洗 → 回填` 管道跑通，再逐步引入智能化。

---

## 推荐目录结构

```
agentic-hr-data/
├── frontend/                  # 看板 HTML（引入 SDK）
├── sdk/src|dist/              # SDK 源码 + UMD 打包产物
├── agent-server/src/
│   ├── index.js               # HTTP 入口 /refresh
│   ├── workflow/ llm/ sandbox/ cache/ mcp-client/
├── mcp-server/src/
│   ├── index.js tools/ resources/ auth/   # Token 只留 auth/
└── shared/hr-fields.schema.json           # 前后端共用字段契约
```

**搭建顺序建议**：MCP 服务端 → Agent 服务端（先手写映射）→ SDK → 前端接入，即按 P0 打通管道后再逐层引入 LLM。