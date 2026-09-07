# AgenticHRdata 项目完整搭建方案

> Agent 驱动的自适应 HR 数据接入系统 —— 让大模型看懂看板需要什么字段,自动从 Workday 取数、清洗、回填前端看板。

---

## 目录

1. [项目总览](#一项目总览)
2. [整体架构设计](#二整体架构设计)
3. [技术选型建议](#三技术选型建议)
4. [模块一:前端 HTML 示例](#四模块一前端-html-示例)
5. [模块二:SDK 层(AgenticHRdata)](#五模块二sdk-层agentichrdata)
6. [模块三:Agent 服务端](#六模块三agent-服务端)
7. [模块四:MCP 服务端](#七模块四mcp-服务端)
8. [安全护栏设计](#八安全护栏设计)
9. [落地路线(MVP → 完整)](#九落地路线mvp--完整)
10. [推荐目录结构](#十推荐目录结构)

---

## 一、项目总览

### 1.1 项目目标

构建一套 **"前端零配置、后端自适应"** 的 HR 数据接入系统:前端看板只需调用 `sdk.refresh(outerHTML)`,系统即可自动理解看板所需字段,从外部系统(Workday)取数、清洗成看板可用格式并回填显示。

### 1.2 核心设计理念

| 理念 | 说明 |
|---|---|
| **慢/快链路分离** | 字段学习"学一次缓存",日常刷新走缓存脚本,不重复调大模型 |
| **单向数据流** | 数据变更统一走 `onChange → state.rows → renderAll`,渲染逻辑零改动 |
| **Agent 编排** | 用 Workflow 编排"理解→取数→清洗→校验→回填"流水线 |
| **安全护栏** | LLM 生成的清洗脚本必须沙箱执行 + schema 校验 |
| **手动触发起步** | 用户手动 `refresh()` 触发,规避 Agent 延迟与成本问题 |

### 1.3 四大模块职责

| 模块 | 职责 | 是否含大模型 |
|---|---|---|
| **前端 HTML** | 展示看板、触发刷新、接收数据回填 | ❌ |
| **SDK 层** | 桥接前端与 Agent 服务端、管理共享内存、广播变更 | ❌ |
| **Agent 服务端** | 理解字段、编排 Workflow、生成/执行清洗脚本 | ✅ |
| **MCP 服务端** | 封装 Workday API 为标准 tool + resource | ❌ |

---

## 二、整体架构设计

### 2.1 系统架构总图

```
┌─────────────────────── 浏览器(客户端) ───────────────────────┐
│                                                               │
│  ┌─ 前端 HTML 看板 ──────────────────────────────────────┐    │
│  │  btnRefresh.onclick = () => sdk.refresh(outerHTML)    │    │
│  │  renderAll() ← state.rows                             │    │
│  └───────────────────────┬───────────────────────────────┘    │
│                          │ 调用                                │
│  ┌─ AgenticHRdata(内存共享层)──────────────────────────┐    │
│  │  _rows / onChange 广播 / refresh() / uploadSnapshot() │    │
│  └───────────────────────┬───────────────────────────────┘    │
└──────────────────────────┼─────────────────────────────────────┘
                           │ HTTPS(脱敏后的 outerHTML)
┌──────────────────────────▼─── Agent 服务端 ────────────────────┐
│  ┌─ Workflow 编排器 ──────────────────────────────────────┐    │
│  │  [慢链路·学习] 无缓存 → LLM 读HTML → 产字段映射+清洗脚本 │    │
│  │                        → 沙箱校验 → 固化缓存            │    │
│  │  [快链路·取数] 有缓存 → 直接用缓存脚本(无大模型)      │    │
│  └────────────────────────┬──────────────────────────────┘    │
│                           │ MCP 协议调用                        │
└───────────────────────────┼─────────────────────────────────────┘
                           │
┌──────────────────────────▼─── MCP 服务端(自建)──────────────┐
│  tool: callWorkdayAPI(endpoint, params)  ──► Workday REST API │
│  resource: workday.schema.json(各 API 的 JSON Schema)        │
└───────────────────────────┬─────────────────────────────────────┘
                           │ 原始 JSON
                           ▼
              沙箱清洗脚本 → schema 校验 → 标准 rows[]
                           │
                           ▼ 回传 SDK.onChange → state.rows → renderAll
```

### 2.2 双链路数据流

```
慢链路(偶尔·学习字段):
  outerHTML → Agent 理解 → 产出「字段映射表 + 清洗脚本」→ 沙箱校验 → 缓存

快链路(每次 refresh·取数):
  缓存映射 → MCP 调 Workday → 缓存脚本清洗 → schema 校验 → 回填看板
                                                         ↑ 无大模型参与
```

### 2.3 控制流时序

```mermaid
sequenceDiagram
    participant U as 用户
    participant H as 前端HTML
    participant S as SDK
    participant A as Agent服务端
    participant M as MCP服务端
    participant W as Workday

    U->>H: 点击刷新
    H->>S: sdk.refresh(outerHTML)
    S->>A: POST /refresh (脱敏HTML)
    A->>A: 查字段映射缓存
    alt 缓存未命中(慢链路)
        A->>A: LLM 读HTML → 产映射+清洗脚本
        A->>A: 沙箱校验 → 固化缓存
    end
    A->>M: 调 callWorkdayAPI
    M->>W: 请求 Workday REST
    W-->>M: 原始 JSON
    M-->>A: 标准化 JSON + schema
    A->>A: 沙箱运行清洗脚本 → schema校验
    A-->>S: 返回标准 rows[]
    S->>S: _rows = rows; onChange(rows)
    S->>H: state.rows = rows; renderAll()
    H-->>U: 看板刷新显示新数据
```

---

## 三、技术选型建议

| 层 | 推荐技术 | 理由 |
|---|---|---|
| 前端看板 | 原生 HTML/JS(沿用现有看板) | 零改造成本,复用 `renderAll` |
| SDK 打包 | UMD / ESM,`window.AgenticHRdata` 挂全局 | 与 jdmap-gl 同构,`<script>` 即用 |
| Agent 服务端 | Node.js + Express/Fastify | 与前端同语言,生态成熟 |
| Workflow 编排 | 自研代码编排(起步)→ 复杂后迁 LangGraph | 门槛低,渐进演进 |
| 大模型 | 任意支持 function-calling 的 LLM | 通过 MCP 解耦,可替换 |
| MCP 服务端 | `@modelcontextprotocol/sdk`(Node.js) | 官方 SDK,tool/resource 标准化 |
| 沙箱执行 | `isolated-vm` / Worker / 独立容器 | 隔离 LLM 生成脚本,禁网禁 FS |
| 缓存 | Redis(字段映射+脚本)/ 文件 | 快链路命中,避免重复调 LLM |
| 数据校验 | `ajv`(JSON Schema) | 校验清洗输出字段/类型 |

---

## 四、模块一:前端 HTML 示例

### 4.1 职责边界

前端**只做三件事**:引入 SDK、触发刷新、把回填的数据交给现有渲染逻辑。**不理解业务、不碰后端、不改渲染代码。**

### 4.2 接入示例

```html
<!-- 1) 引入 SDK(与 jdmap-gl 同构) -->
<script src="./agentic-hr-data.js"></script>

<script>
// 2) 初始化 SDK —— 数据一变就回填看板
const sdk = new AgenticHRdata({
  endpoint: 'https://agent.xxx.com/refresh',   // Agent 服务端地址
  appKey:   'YOUR_APP_KEY',                     // 鉴权(勿硬编码到生产)
  onChange: (rows) => {                         // 单向广播回调
    state.rows = rows;                          // 写入共享内存
    renderAll();                                // 复用现有渲染,零改动
  },
});

// 3) 用户手动触发刷新:把当前看板快照交给 Agent 去"理解 + 取数"
document.getElementById('btnRefresh').onclick = async () => {
  const btn = document.getElementById('btnRefresh');
  btn.disabled = true; btn.textContent = '刷新中…';
  try {
    // outerHTML 让 Agent 理解"这个看板需要哪些字段"
    await sdk.refresh(document.documentElement.outerHTML);
  } catch (e) {
    alert('刷新失败:' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '刷新数据';
  }
};
</script>
```

### 4.3 与现有看板的最小改造点

| 位置 | 原逻辑 | 改造后 |
|---|---|---|
| 初始化 | `state.rows = load() \|\| seedRows()` | 保留作为**降级 fallback**,主数据走 `sdk.refresh` |
| 刷新按钮 | 无 | 新增 `#btnRefresh` → `sdk.refresh(outerHTML)` |
| 渲染 | `renderAll()` | **完全不变**,仍由 `onChange` 触发 |

> 关键:渲染层零改动。SDK 只负责把 `state.rows` 换成真实数据,后续 `metricData/renderKPI` 等一律不动。

---

## 五�模块二:SDK 层(AgenticHRdata)

### 5.1 职责

SDK 是**前端与 Agent 服务端之间的桥**:管理共享内存 `_rows`、发起请求、脱敏、广播变更。**不含大模型,是纯客户端代码。**

### 5.2 核心 API 契约

| 成员 | 签名 | 作用 |
|---|---|---|
| 构造 | `new AgenticHRdata({endpoint, appKey, onChange})` | 初始化配置 + 注册回调 |
| 刷新 | `refresh(outerHTML): Promise<rows[]>` | 传快照 → 请求 Agent → 回填广播 |
| 读取 | `getRows(): rows[]` | 只读访问共享内存 |
| 自动 | `startAutoRefresh(ms)` / `stopAutoRefresh()` | 可选:定时刷新 |

### 5.3 参考实现

```javascript
class AgenticHRdata {
  constructor({ endpoint, appKey, onChange }) {
    this._rows = [];
    this._endpoint = endpoint;
    this._appKey = appKey;
    this._onChange = onChange;
    this._timer = null;
  }

  // 传快照 → 请求 Agent → 覆盖共享内存 → 广播
  async refresh(outerHTML) {
    const safeHTML = this._sanitize(outerHTML);   // ① 脱敏:剥离含密钥的脚本
    const res = await fetch(this._endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': this._appKey },
      body: JSON.stringify({ outerHTML: safeHTML }),
    });
    if (!res.ok) throw new Error(`Agent 返回 ${res.status}`);
    const { rows } = await res.json();
    this._rows = rows;             // ② 刷新共享内存
    this._onChange?.(this._rows);  // ③ 单向广播
    return this._rows;
  }

  getRows() { return this._rows; }

  startAutoRefresh(ms = 60000, getHTML) {
    this.stopAutoRefresh();
    this._timer = setInterval(() => this.refresh(getHTML()), ms);
  }
  stopAutoRefresh() { clearInterval(this._timer); this._timer = null; }

  // 脱敏:移除内联 <script>,防止 appKey/Token 随快照外泄
  _sanitize(html) {
    return html.replace(/<script[\s\S]*?<\/script>/gi, '<script data-stripped></script>');
  }
}

// 挂全局供 HTML 直接使用(UMD 风格)
if (typeof window !== 'undefined') window.AgenticHRdata = AgenticHRdata;
```

### 5.4 设计要点

- **脱敏是硬要求**:`outerHTML` 含内联脚本,`appKey` 会随快照泄露,发送前必须剥离 `<script>`。
- **快照可能很大**:整页 HTML 数百 KB,可只截取 `<script>` 里的 `FIELDS/TABLE_COLS` 定义片段发送,减少传输与 Token 成本。
- **单向数据流**:SDK 只通过 `onChange` 向外广播,绝不反向操作 DOM。

---

## 六、模块三:Agent 服务端

### 6.1 职责

Agent 服务端是**系统大脑**:理解看板字段、编排 Workflow、调用 MCP 取数、生成/执行清洗脚本、返回标准 rows。**唯一含大模型的模块。**

### 6.2 双链路设计(核心)

```
┌─ POST /refresh ─────────────────────────────────────┐
│  1. 计算 HTML 指纹(hash 字段定义片段)             │
│  2. 查缓存: fieldMap + cleanScript 是否存在?        │
│                                                     │
│  ├─ 命中(快链路,无 LLM)                          │
│  │    → 调 MCP 取数 → 缓存脚本清洗 → 校验 → 返回     │
│  │                                                  │
│  └─ 未命中(慢链路,含 LLM)                        │
│       → LLM 读HTML 产 fieldMap + cleanScript        │
│       → 沙箱校验通过 → 写缓存 → 再走快链路           │
└─────────────────────────────────────────────────────┘
```

### 6.3 Workflow 编排实现

```javascript
// Step:最小执行单元,带重试
class Step {
  constructor(name, fn, { retries = 0 } = {}) { this.name = name; this.fn = fn; this.retries = retries; }
  async run(ctx) {
    for (let i = 0; i <= this.retries; i++) {
      try { return await this.fn(ctx); }
      catch (e) { if (i === this.retries) throw e; }
    }
  }
}

// Workflow:串行编排 + 上下文传递 + 链路追踪
class Workflow {
  constructor(name) { this.name = name; this.steps = []; }
  add(step) { this.steps.push(step); return this; }
  async run(ctx = {}) {
    ctx._trace = [];
    for (const s of this.steps) {
      const t = Date.now();
      ctx[s.name] = await s.run(ctx);
      ctx._trace.push({ step: s.name, ms: Date.now() - t });
    }
    return ctx;
  }
}
```

### 6.4 refresh 流水线编排

```javascript
const refreshWorkflow = new Workflow('hr-refresh')
  // ① 指纹 + 查缓存
  .add(new Step('cacheKey', ctx => fingerprint(ctx.outerHTML)))
  .add(new Step('cached',   ctx => cache.get(ctx.cacheKey)))
  // ② 慢链路:缓存未命中才调 LLM 学字段
  .add(new Step('learn', async ctx => {
    if (ctx.cached) return ctx.cached;                     // 命中直接跳过
    const plan = await llm.analyzeFields(ctx.outerHTML);   // LLM 产字段映射
    const script = await llm.genCleanScript(plan);         // LLM 产清洗脚本
    validateScript(script);                                // 沙箱静态校验
    const learned = { fieldMap: plan.fieldMap, script };
    await cache.set(ctx.cacheKey, learned);                // 固化缓存
    return learned;
  }))
  // ③ 快链路:调 MCP 取 Workday 原始数据
  .add(new Step('fetchRaw', ctx =>
    mcpClient.callTool('callWorkdayAPI', { fields: ctx.learn.fieldMap }),
    { retries: 2 }))
  // ④ 沙箱运行清洗脚本
  .add(new Step('clean', ctx => sandbox.run(ctx.learn.script, ctx.fetchRaw)))
  // ⑤ schema 校验输出
  .add(new Step('validate', ctx => validateRows(ctx.clean, HR_FIELDS_SCHEMA)));

// HTTP 入口
app.post('/refresh', async (req, res) => {
  try {
    const ctx = await refreshWorkflow.run({ outerHTML: req.body.outerHTML });
    res.json({ rows: ctx.validate, trace: ctx._trace });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

### 6.5 LLM 的两个任务

| 任务 | 输入 | 输出 | 何时执行 |
|---|---|---|---|
| **理解字段** `analyzeFields` | outerHTML(FIELDS/TABLE_COLS 片段) | 字段映射表(看板字段 ↔ Workday 字段) | 仅慢链路 |
| **生成清洗脚本** `genCleanScript` | 字段映射 + Workday schema | 纯函数 `(raw) => rows[]` | 仅慢链路 |

> 关键:两个 LLM 任务的产物都**固化缓存**,日常刷新不再触发,保证快链路毫秒级响应且成本可控。

---

## 七、模块四:MCP 服务端

### 7.1 职责

MCP 服务端把 **Workday 等外部系统的 API 封装成标准 MCP 能力**,供 Agent 统一调用。你负责编写:
- **tool**:每个 API 的调用命令(封装鉴权、请求、错误处理)
- **resource**:每个 API 返回数据的 JSON Schema(供 LLM 理解数据结构)

### 7.2 tool 与 resource 的分工

| 类型 | 是什么 | 例子 | LLM 如何用 |
|---|---|---|---|
| **tool** | 可执行的动作 | `callWorkdayAPI(endpoint, params)` | 决定"调哪个 API、传什么参数" |
| **resource** | 只读的数据描述 | `workday://schema/worker` | 理解"返回数据长什么样",据此写清洗脚本 |

### 7.3 参考实现

```javascript
const { Server } = require('@modelcontextprotocol/sdk/server');

const server = new Server({ name: 'workday-mcp', version: '1.0.0' });

// ── tool:调用 Workday API ──
server.setRequestHandler('tools/list', async () => ({
  tools: [{
    name: 'callWorkdayAPI',
    description: '调用 Workday REST API 获取 HR 数据(员工/入离职/合同等)',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', description: '如 /workers, /timeOff' },
        params:   { type: 'object', description: '查询参数,如 {country:"德国"}' },
      },
      required: ['endpoint'],
    },
  }],
}));

server.setRequestHandler('tools/call', async (req) => {
  const { endpoint, params } = req.params.arguments;
  const token = await getWorkdayToken();               // 鉴权
  const url = `https://wd.workday.com/api${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Workday ${endpoint} 返回 ${res.status}`);
  return { content: [{ type: 'text', text: JSON.stringify(await res.json()) }] };
});

// ── resource:暴露 API 数据 schema ──
server.setRequestHandler('resources/list', async () => ({
  resources: [
    { uri: 'workday://schema/worker',  name: '员工数据结构', mimeType: 'application/json' },
    { uri: 'workday://schema/timeOff', name: '休假数据结构', mimeType: 'application/json' },
  ],
}));

server.setRequestHandler('resources/read', async (req) => {
  const schema = loadSchema(req.params.uri);           // 读对应 JSON Schema
  return { contents: [{ uri: req.params.uri, mimeType: 'application/json', text: JSON.stringify(schema) }] };
});
```

### 7.4 resource(schema)示例

```json
// workday://schema/worker
{
  "type": "object",
  "properties": {
    "worker_id":   { "type": "string" },
    "legal_name":  { "type": "string" },
    "hire_date":   { "type": "string", "format": "date" },
    "country":     { "type": "string" },
    "cost_center": { "type": "string" },
    "job_profile": { "type": "string" }
  }
}
```

### 7.5 设计要点

- **tool 描述要精确**:`description` 与 `inputSchema` 是 LLM 调用的唯一依据,写清用途和参数含义。
- **鉴权封装在 MCP 内部**:Workday Token 只存在 MCP 服务端,Agent 与前端都拿不到,降低泄露面。
- **schema 即契约**:resource 提供的 schema 让 LLM"看懂原始数据",才能生成正确的清洗脚本。
- **一 API 一 tool 或参数化**:少量 API 可用一个参数化 `callWorkdayAPI`;API 众多时按业务拆多个 tool 更清晰。

---

## 八、安全护栏设计

LLM 生成并运行清洗脚本是全系统**最大风险点**,必须多层防护。

### 8.1 四层护栏

| 层 | 护栏 | 作用 |
|---|---|---|
| ① 输入脱敏 | SDK 剥离 `<script>` | 防 appKey/Token 随快照外泄 |
| ② 脚本沙箱 | `isolated-vm` / Worker | LLM 脚本禁网、禁文件系统、限内存/超时 |
| ③ 输出校验 | `ajv` schema 校验 | 清洗结果字段/类型不匹配则拒绝回填 |
| ④ 人工审核 | 首次脚本固化前人工过目 | 避免恶意/错误脚本进缓存 |

### 8.2 沙箱执行示例

```javascript
const ivm = require('isolated-vm');

async function runInSandbox(script, rawData, { timeout = 3000 } = {}) {
  const isolate = new ivm.Isolate({ memoryLimit: 64 });   // 限内存
  const ctx = await isolate.createContext();
  await ctx.global.set('raw', new ivm.ExternalCopy(rawData).copyInto());
  const fn = await ctx.eval(                                 // 禁网禁 FS
    `(function(){ ${script}; return clean(raw); })()`,
    { timeout }                                             // 限超时
  );
  return fn;
}
```

### 8.3 输出校验示例

```javascript
const Ajv = require('ajv');
const validate = new Ajv().compile(HR_FIELDS_SCHEMA);

function validateRows(rows, schema) {
  if (!Array.isArray(rows)) throw new Error('清洗输出必须是数组');
  for (const r of rows) {
    if (!validate(r)) throw new Error('字段校验失败:' + JSON.stringify(validate.errors));
  }
  return rows;   // 通过才回填
}
```

### 8.4 其他安全要点

- **鉴权链**:前端 appKey → Agent 校验 → MCP 内部持有 Workday Token,逐层收敛权限。
- **CORS**:Agent 服务端只放行看板域名。
- **审计日志**:记录每次 refresh 的 `_trace`、LLM 产物、清洗结果,便于追溯。
- **速率限制**:手动 refresh 加防抖/节流,防止刷爆 Workday。

---

## 九、落地路线(MVP → 完整)

| 阶段 | 目标 | 是否用 LLM | 验收标准 |
|---|---|---|---|
| **P0** | 手写映射+清洗,SDK 直连 MCP 取 Workday 回填看板 | ❌ | 数据管道跑通,看板显示真实数据 |
| **P1** | 加 Agent"学习"环节,自动产字段映射(人工审核) | ✅ 仅学习 | LLM 能正确产出字段映射表 |
| **P2** | 清洗脚本自动生成 + 沙箱执行 + schema 校验 | ✅ | 脚本沙箱运行,校验拦截错误输出 |
| **P3** | 字段变更自动感知、缓存失效、多数据源扩展 | ✅ | 完整慢/快链路闭环,支持多外部系统 |

> **强烈建议 P0 先不上大模型**:用手写映射把 `MCP → Workday → 清洗 → 回填看板` 数据管道跑通,验证链路正确,再逐步引入 Agent 智能化。风险可控、每步可验证。

---

## 十、推荐目录结构

```
agentic-hr-data/
├── frontend/
│   └── europe_hr_talent_dashboard.html   # 看板(引入 SDK)
├── sdk/
│   ├── src/agentic-hr-data.js           # SDK 源码
│   └── dist/agentic-hr-data.umd.js      # 打包产物(挂全局)
├── agent-server/
│   ├── src/
│   │   ├── index.js                       # HTTP 入口 /refresh
│   │   ├── workflow/                       # Step / Workflow 编排
│   │   ├── llm/                            # analyzeFields / genCleanScript
│   │   ├── sandbox/                        # isolated-vm 沙箱执行
│   │   ├── cache/                          # 字段映射+脚本缓存(Redis)
│   │   └── mcp-client/                     # 调 MCP 服务端
│   └── package.json
├── mcp-server/
│   ├── src/
│   │   ├── index.js                       # MCP Server 启动
│   │   ├── tools/callWorkdayAPI.js        # Workday API 调用命令
│   │   ├── resources/                      # 各 API 的 JSON Schema
│   │   └── auth/workday-token.js          # Workday 鉴权(Token 只留此处)
│   └── package.json
└── shared/
    └── hr-fields.schema.json              # 看板字段契约(前后端共用)
```

---

## 附:一句话总览

**前端**只调 `sdk.refresh(outerHTML)` 并复用 `renderAll`;**SDK** 负责脱敏、桥接、广播;**Agent 服务端**用 Workflow 编排"慢链路学一次字段+快链路取数清洗",LLM 产物固化缓存;**MCP 服务端**把 Workday API 封装为 tool+resource;全链路以"沙箱执行 + schema 校验 + 逐层鉴权"三重护栏兜底。建议 P0 先用手写映射跑通数据管道,再分阶段引入 Agent 智能化。