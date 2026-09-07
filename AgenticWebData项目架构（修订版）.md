# AgenticWebData 项目完整搭建方案（进阶版 · 修订版）

> Agent 驱动的自适应 Web 数据接入系统（进阶版）—— 多 Agent 协同 + 双 MCP 服务端：监管者 Agent 统筹质检，子 Agent 有向分工——**子 Agent 1 为纯分析上游节点**（不做 function calling，产出字段映射传给下游），**子 Agent 2 / 3 各含 LLM**（负责判断调用 MCP tool 中哪个函数），分别经 MCP 服务端 A（外部系统 API）与 MCP 服务端 B（结构化 + 非结构化数据库）取数、写库、清洗、回填前端页面。

---

## 目录

1. [项目总览](#一项目总览)
2. [整体架构设计](#二整体架构设计)
3. [技术选型建议](#三技术选型建议)
4. [模块一:前端 HTML 示例](#四模块一前端-html-示例)
5. [模块二:SDK 层(AgenticWebData)](#五模块二sdk-层agenticwebdata)
6. [模块三:Agent 服务端（多 Agent 架构）](#六模块三agent-服务端多-agent-架构)
7. [模块四:MCP 服务端（A/B 双服务端）](#七模块四mcp-服务端ab-双服务端)
8. [安全护栏设计](#八安全护栏设计)
9. [落地路线(MVP → 完整)](#九落地路线mvp--完整)
10. [推荐目录结构](#十推荐目录结构)

---

## 一、项目总览

### 1.1 项目目标

构建一套 **"前端零配置、后端自适应"** 的 Web 数据接入系统:前端页面只需调用 `sdk.refresh(outerHTML)`,系统即可自动理解页面所需字段,从外部系统取数、清洗成页面可用格式并回填显示。

### 1.2 核心设计理念

| 理念 | 说明 |
|---|---|
| **慢/快链路分离** | 字段映射与 tool 调用计划"学一次缓存",日常刷新复用缓存计划直调 MCP,不重复走 LLM 推理 |
| **单向数据流** | 数据变更统一走 `onChange → state.rows → renderAll`,渲染逻辑零改动 |
| **多 Agent 有向协同** | 监管者统筹编排;子 Agent 1 在上游纯分析,子 Agent 2/3 在下游含 LLM 选 Tool 并执行,各司其职 |
| **质检闭环** | 监管者对每个子 Agent 的产物做质量核验,不合格则退回重做 |
| **双 MCP 解耦** | MCP-A 封装外部系统 API,MCP-B 统一封装结构化与非结构化数据库,能力标准化、可独立扩展 |
| **安全护栏** | LLM 生成的清洗/SQL 脚本必须沙箱执行 + schema 校验 + 写库审计 |
| **手动触发起步** | 用户手动 `refresh()` 触发,规避 Agent 延迟与成本问题 |

### 1.3 模块职责总览

| 模块 | 职责 | 是否含大模型 |
|---|---|---|
| **前端 HTML** | 展示页面、触发刷新、接收数据回填 | ❌ |
| **SDK 层** | 桥接前端与 Agent 服务端、管理共享内存、广播变更 | ❌ |
| **Agent 服务端(多 Agent)** | 监管者统筹质检 + 子 Agent 有向分工(纯分析 / 选 Tool 调外部系统 / 选 Tool 读写数据库) | ✅ |
| **MCP 服务端 A** | 封装外部系统 REST API 为 tool + resource | ❌ |
| **MCP 服务端 B** | 统一封装结构化数据库(SQL 函数)与非结构化数据库(文档/检索操作)为 tool + resource | ❌ |

#### 多 Agent 职责细分

| Agent | 角色 | 职责 | 下游 |
|---|---|---|---|
| **监管者 Agent** | Supervisor | 拆解任务、调度子 Agent、核验每个子 Agent 的完成质量、不合格退回重试 | 子 Agent 1/2/3 |
| **子 Agent 1** | 分析师(上游·纯分析) | 分析回传的 HTML,判断页面需要哪些数据字段,产字段映射并传给子 Agent 2/3;**不做 function calling,不调任何工具** | 子 Agent 2/3 |
| **子 Agent 2** | 外部系统执行器(**含 LLM**) | 接收字段映射,**LLM 判断调用 MCP-A 中哪个 tool 函数**,调下游外部系统 API 取数 | MCP-A → 外部系统 |
| **子 Agent 3** | 数据库执行器(**含 LLM**) | 接收字段映射,**LLM 判断调用 MCP-B 中哪个 tool 函数**,完成结构化 / 非结构化数据库的写入与读取 | MCP-B → 数据库 |

---

## 二、整体架构设计

### 2.1 系统架构总图

```
┌────────────────── 浏览器(客户端) ──────────────────┐
│  前端 HTML 页面  btnRefresh → sdk.refresh(outerHTML) │
│  AgenticWebData(内存共享层)_rows / onChange 广播     │
└──────────────────────────┬───────────────────────────┘
                           │ HTTPS(脱敏后的 outerHTML)
┌──────────────────────────▼─ Agent 服务端(多 Agent 架构)─┐
│   ┌──────────── 监管者 Agent(Supervisor)───────────┐    │
│   │ 拆解任务 → 调度子 Agent → 核验产物质量 → 退回重试 │    │
│   └──┬──────────────┬────────────────┬──────────────┘    │
│      │ 分析任务      │ 取数任务        │ 读写任务          │
│  ┌───▼────┐   ┌──────▼──────┐   ┌─────▼──────┐            │
│  │子Agent1│   │  子Agent2   │   │  子Agent3  │            │
│  │纯分析HTML│  │含LLM·选Tool │   │含LLM·选Tool │           │
│  │产字段映射│─→│经MCP-A调外部│   │经MCP-B读写数│           │
│  │(不调工具)│  │系统API取数  │   │据库(结构化/│           │
│  └────────┘   └──────┬──────┘   │ 非结构化)   │            │
│   上游:字段映射       │ MCP 协议  └─────┬──────┘            │
│   传给子Agent2/3      │                 │ MCP 协议          │
└──────────────────────┼─────────────────┼──────────────────┘
                       │                 │
      ┌────────────────▼─────┐   ┌───────▼──────────────────────────┐
      │  MCP 服务端 A         │   │  MCP 服务端 B                     │
      │ tool: callExternalAPI │   │ tool: 结构化 query/insert/update/ │
      │  (endpoint, params)   │   │  delete;非结构化 search/get/put   │
      │ resource: API schema  │   │ resource: 表 schema + 集合/索引   │
      └───────────┬───────────┘   └───────────┬──────────────────────┘
                  │ REST 请求                  │ SQL / NoSQL 查询
      ┌───────────▼───────────┐   ┌───────────▼───────────┐ ┌──────────────────────┐
      │ 下游:外部系统 API     │   │ 下游:结构化数据库     │ │ 下游:非结构化数据库   │
      │ (REST / GraphQL/...)  │   │ (MySQL / PostgreSQL)  │ │ (MongoDB / ES /      │
      │ /list /detail ...     │   │ 表:records / stats    │ │  对象存储) 文档/索引  │
      └───────────────────────┘   └───────────────────────┘ └──────────────────────┘
                  │                            │
                  └─────────────┬──────────────┘
                                │ 原始数据(JSON / 结果集 / 文档)
                                ▼
          监管者质检 → 沙箱清洗脚本 → schema 校验 → 标准 rows[]
                                │
                                ▼ 回传 SDK.onChange → renderAll
```

### 2.2 双链路 × 多 Agent 数据流

```
慢链路(偶尔·学一次缓存,LLM 深度参与):
  outerHTML → 监管者派发 → 子Agent1 纯分析HTML(不做 function calling)
            → 产「字段映射」传给子Agent2/3
            → 子Agent2/3 各自 LLM 首次选择 MCP tool,产「tool 调用计划」
            → 生成清洗脚本 → 监管者质检(字段/歧义/tool 选择合理性)
            → 沙箱校验 → 「字段映射 + tool 调用计划 + 清洗脚本」固化缓存

快链路(每次 refresh·复用缓存计划,默认无 LLM 推理):
  缓存命中 → 监管者并行派发(无需子Agent1)
    ├─ 子Agent2 复用缓存 tool 计划 → MCP-A → 外部系统 API 取数
    └─ 子Agent3 复用缓存 tool 计划 → MCP-B → 结构化/非结构化数据库 读/写
  → 汇总原始数据 → 缓存脚本清洗 → schema 校验 → 监管者终检 → 回填页面
              ↑ 子Agent2/3 的 LLM 仅在缓存未命中时参与 tool 选择
```

### 2.3 控制流时序

```mermaid
sequenceDiagram
    participant U as 用户
    participant H as 前端HTML
    participant S as SDK
    participant SUP as 监管者Agent
    participant A1 as 子Agent1(纯分析·上游)
    participant A2 as 子Agent2(含LLM·MCP-A选Tool)
    participant A3 as 子Agent3(含LLM·MCP-B选Tool)
    participant MA as MCP服务端A
    participant MB as MCP服务端B
    participant EXT as 外部系统API
    participant DB as 数据库(结构化/非结构化)

    U->>H: 点击刷新
    H->>S: sdk.refresh(outerHTML)
    S->>SUP: POST /refresh (脱敏HTML)
    SUP->>SUP: 查缓存(fieldMap + toolPlan + cleanScript)
    alt 缓存未命中(慢链路)
        SUP->>A1: 派发:分析HTML需要哪些数据
        A1->>A1: LLM 纯分析(不做 function calling) → 需求清单+字段映射
        A1-->>SUP: 返回字段映射(上游产出)
        SUP->>A2: 传字段映射 → LLM 选择 MCP-A tool
        SUP->>A3: 传字段映射 → LLM 选择 MCP-B tool
        Note over A2,A3: 产出 tool 调用计划
        SUP->>SUP: 质检:字段完整性/歧义/tool 选择合理性
        SUP->>SUP: 生成清洗脚本 → 沙箱校验 → 固化缓存
    end
    par 并行取数(快链路,复用缓存 tool 计划)
        SUP->>A2: 派发:按计划调外部系统接口
        A2->>MA: 调 callExternalAPI
        MA->>EXT: 请求外部系统 REST
        EXT-->>MA: 原始 JSON
        MA-->>A2: 标准化 JSON + schema
        A2-->>SUP: 外部系统数据
    and
        SUP->>A3: 派发:按计划读写数据库
        A3->>MB: 调 query/insert 或 search/get/put
        MB->>DB: 执行 SQL(参数化)/ NoSQL 命名操作
        DB-->>MB: 结果集 / 文档
        MB-->>A3: 行数据 + schema
        A3-->>SUP: 数据库数据
    end
    SUP->>SUP: 汇总 → 沙箱清洗 → schema校验 → 终检
    SUP-->>S: 返回标准 rows[]
    S->>S: _rows = rows; onChange(rows)
    S->>H: state.rows = rows; renderAll()
    H-->>U: 页面刷新显示新数据
```

---

## 三、技术选型建议

| 层 | 推荐技术 | 理由 |
|---|---|---|
| 前端页面 | 原生 HTML/JS(沿用现有页面) | 零改造成本,复用 `renderAll` |
| SDK 打包 | UMD / ESM,`window.AgenticWebData` 挂全局 | 与 jdmap-gl 同构,`<script>` 即用 |
| Agent 服务端 | Node.js + Express/Fastify | 与前端同语言,生态成熟 |
| 多 Agent 编排 | LangGraph Supervisor 模式 | 监管者调度 3 个子 Agent,支持质检回环;子 Agent 1→2/3 为天然有向边 |
| 大模型 | 任意支持 function-calling 的 LLM | 子 Agent 1 用于语义分析,子 Agent 2/3 用于 tool 选择;通过 MCP 解耦,可替换 |
| MCP 服务端 A(外部系统) | `@modelcontextprotocol/sdk`(Node.js) | tool=callExternalAPI,连外部系统 REST |
| MCP 服务端 B(数据库) | `@modelcontextprotocol/sdk` + `mysql2`/`pg` + `mongodb`/`@elastic/elasticsearch` | tool=结构化 SQL 函数 + 非结构化 search/get/put,resource=表 schema 与集合/索引结构 |
| 沙箱执行 | `isolated-vm` / Worker / 独立容器 | 隔离 LLM 生成脚本,禁网禁 FS |
| 缓存 | Redis(字段映射 + tool 调用计划 + 脚本)/ 文件 | 快链路命中,避免重复走 LLM 推理 |
| 数据校验 | `ajv`(JSON Schema) | 校验清洗输出字段/类型 |

---

## 四、模块一:前端 HTML 示例

### 4.1 职责边界

前端**只做三件事**:引入 SDK、触发刷新、把回填的数据交给现有渲染逻辑。**不理解业务、不碰后端、不改渲染代码。**

### 4.2 接入示例

```html
<!-- 1) 引入 SDK(与 jdmap-gl 同构) -->
<script src="./agentic-web-data.js"></script>

<script>
// 2) 初始化 SDK —— 数据一变就回填页面
const sdk = new AgenticWebData({
  endpoint: 'https://agent.xxx.com/refresh',   // Agent 服务端地址
  appKey:   'YOUR_APP_KEY',                     // 鉴权(勿硬编码到生产)
  onChange: (rows) => {                         // 单向广播回调
    state.rows = rows;                          // 写入共享内存
    renderAll();                                // 复用现有渲染,零改动
  },
});

// 3) 用户手动触发刷新:把当前页面快照交给 Agent 去"理解 + 取数"
document.getElementById('btnRefresh').onclick = async () => {
  const btn = document.getElementById('btnRefresh');
  btn.disabled = true; btn.textContent = '刷新中…';
  try {
    // outerHTML 让 Agent 理解"这个页面需要哪些字段"
    await sdk.refresh(document.documentElement.outerHTML);
  } catch (e) {
    alert('刷新失败:' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '刷新数据';
  }
};
</script>
```

### 4.3 与现有页面的最小改造点

| 位置 | 原逻辑 | 改造后 |
|---|---|---|
| 初始化 | `state.rows = load() \|\| seedRows()` | 保留作为**降级 fallback**,主数据走 `sdk.refresh` |
| 刷新按钮 | 无 | 新增 `#btnRefresh` → `sdk.refresh(outerHTML)` |
| 渲染 | `renderAll()` | **完全不变**,仍由 `onChange` 触发 |

> 关键:渲染层零改动。SDK 只负责把 `state.rows` 换成真实数据,后续 `metricData/renderKPI` 等一律不动。

---

## 五、模块二:SDK 层(AgenticWebData)

### 5.1 职责

SDK 是**前端与 Agent 服务端之间的桥**:管理共享内存 `_rows`、发起请求、脱敏、广播变更。**不含大模型,是纯客户端代码。**

### 5.2 核心 API 契约

| 成员 | 签名 | 作用 |
|---|---|---|
| 构造 | `new AgenticWebData({endpoint, appKey, onChange})` | 初始化配置 + 注册回调 |
| 刷新 | `refresh(outerHTML): Promise<rows[]>` | 传快照 → 请求 Agent → 回填广播 |
| 读取 | `getRows(): rows[]` | 只读访问共享内存 |
| 自动 | `startAutoRefresh(ms)` / `stopAutoRefresh()` | 可选:定时刷新 |

### 5.3 参考实现

```javascript
class AgenticWebData {
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
if (typeof window !== 'undefined') window.AgenticWebData = AgenticWebData;
```

### 5.4 设计要点

- **脱敏是硬要求**:`outerHTML` 含内联脚本,`appKey` 会随快照泄露,发送前必须剥离 `<script>`。
- **快照可能很大**:整页 HTML 数百 KB,可只截取 `<script>` 里的 `FIELDS/TABLE_COLS` 定义片段发送,减少传输与 Token 成本。
- **单向数据流**:SDK 只通过 `onChange` 向外广播,绝不反向操作 DOM。

---

## 六、模块三:Agent 服务端(多 Agent 架构)

### 6.1 职责

Agent 服务端是**系统大脑**,采用**监管者(Supervisor)+ 3 个子 Agent** 的多 Agent 架构:理解页面需求、并行调用双 MCP 取数、生成/执行清洗脚本、质检核验、返回标准 rows。**唯一含大模型的模块。**

| 角色 | 职责 | 是否含 LLM |
|---|---|---|
| **监管者 Agent** | 任务派发、并行编排、**核验每个子 Agent 完成质量**、汇总终检 | 是(质检推理) |
| **子 Agent1(需求分析·上游)** | 纯分析回传 HTML,输出"需要哪些数据"的需求清单 + 字段映射,**传给子 Agent 2/3;不做 function calling** | 是(纯分析) |
| **子 Agent2(MCP-A 执行)** | 接收字段映射,**LLM 判断调用 MCP-A 哪个 tool**,调下游外部系统接口取数 | 是(tool 选择) |
| **子 Agent3(MCP-B 执行)** | 接收字段映射,**LLM 判断调用 MCP-B 哪个 tool**,对结构化 / 非结构化数据库读/写 | 是(tool 选择) |

> 有向分工:子 Agent 1 是**上游纯分析节点**,只产字段映射、不触碰任何工具;子 Agent 2/3 是**下游执行节点**,其 LLM 的职责是 **Tool Selection**——读 MCP 服务端暴露的 tool 列表与 resource schema,判断该调哪个 tool 函数、传什么参数。

### 6.2 双链路 + 多 Agent 设计(核心)

```
┌─ POST /refresh ─────────────────────────────────────────────────┐
│  监管者 Agent 接管:                                              │
│  1. 计算 HTML 指纹 → 查缓存(fieldMap + toolPlan + cleanScript)  │
│                                                                 │
│  ├─ 命中(快链路,无需子Agent1,默认无 LLM 推理)                │
│  │    → 并行派发 子Agent2/3,复用缓存 tool 调用计划直调 MCP     │
│  │    → 汇总原始数据 → 缓存脚本清洗 → schema校验 → 终检返回      │
│  │                                                              │
│  └─ 未命中(慢链路,LLM 深度参与)                               │
│       → 子Agent1 纯分析HTML 产 需求清单+fieldMap(不调工具)      │
│       → fieldMap 传给子Agent2/3:各自 LLM 首次选 tool 产 toolPlan│
│       → 生成 cleanScript → 监管者质检(字段/歧义/tool 选择)     │
│       → 沙箱校验 → 「fieldMap+toolPlan+cleanScript」写缓存       │
│       → 再走快链路并行取数                                       │
│                                                                 │
│  质检回环:任一子Agent产物不达标 → 监管者退回重试(≤N次)         │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 监管者 Agent 编排实现

```javascript
// 子 Agent 基类:执行 + 自检
class SubAgent {
  constructor(name, fn, { retries = 1 } = {}) { this.name = name; this.fn = fn; this.retries = retries; }
  async run(ctx) {
    for (let i = 0; i <= this.retries; i++) {
      const out = await this.fn(ctx);
      if (this.selfCheck(out)) return out;      // 自检通过才返回
      if (i === this.retries) throw new Error(`${this.name} 质检失败`);
    }
  }
  selfCheck(out) { return out != null; }        // 子类可覆写
}

// 监管者:派发 + 并行编排 + 质检核验 + 汇总
class SupervisorAgent {
  constructor() { this.trace = []; }
  verify(agentName, out, rule) {
    const ok = rule(out);
    this.trace.push({ agent: agentName, verified: ok });
    if (!ok) throw new Error(`监管者核验未通过: ${agentName}`);
    return out;
  }
}
```

### 6.4 refresh 多 Agent 流水线

```javascript
const supervisor = new SupervisorAgent();

// 子 Agent1:纯分析 HTML 需要什么数据(仅慢链路;不做 function calling)
const agent1 = new SubAgent('demand-analyze', async ctx => {
  const plan = await llm.analyzeFields(ctx.outerHTML);   // 纯分析:需求清单+字段映射
  return { fieldMap: plan.fieldMap, demand: plan.demand };
});

// 子 Agent2:含 LLM —— 依据 fieldMap + MCP-A 的 tool 列表/resource 选择 tool 并执行
const agent2 = new SubAgent('mcp-a-fetch', async ctx => {
  const sel = ctx.learn.toolPlan?.a                        // 快链路:复用缓存计划
           ?? await llm.selectTool(ctx.learn.fieldMap, await mcpClientA.listTools()); // 慢链路:LLM 选 tool
  return mcpClientA.callTool(sel.tool, sel.args);
}, { retries: 2 });

// 子 Agent3:含 LLM —— 依据 fieldMap + MCP-B 的 tool 列表/schema 选择 tool 并执行
const agent3 = new SubAgent('mcp-b-db', async ctx => {
  const sel = ctx.learn.toolPlan?.b
           ?? await llm.selectTool(ctx.learn.fieldMap, await mcpClientB.listTools());
  return mcpClientB.callTool(sel.tool, sel.args);          // query/insert 或 search/get/put
}, { retries: 2 });

app.post('/refresh', async (req, res) => {
  try {
    const ctx = { outerHTML: req.body.outerHTML };
    ctx.cacheKey = fingerprint(ctx.outerHTML);
    ctx.cached = await cache.get(ctx.cacheKey);

    // ① 慢链路:子Agent1 纯分析产 fieldMap → 子Agent2/3 首次选 tool → 监管者质检 → 固化缓存
    if (!ctx.cached) {
      const learned = await agent1.run(ctx);
      supervisor.verify('demand-analyze', learned, l => l.fieldMap);
      ctx.learn = learned;                                  // toolPlan 在 agent2/3 首跑时生成
      const script = await llm.genCleanScript(learned);     // 生成清洗脚本
      validateScript(script);                               // 沙箱静态校验
      ctx.learn.script = script;
    } else { ctx.learn = ctx.cached; }

    // ② 快链路:监管者并行派发 子Agent2 + 子Agent3(复用缓存 toolPlan,默认无 LLM 推理)
    const [extData, dbData] = await Promise.all([ agent2.run(ctx), agent3.run(ctx) ]);
    supervisor.verify('mcp-a-fetch', extData, d => Array.isArray(d) || d?.rows);
    supervisor.verify('mcp-b-db',    dbData,  d => Array.isArray(d) || d?.rows);

    // 首次跑通后固化「fieldMap + toolPlan + cleanScript」
    if (!ctx.cached) await cache.set(ctx.cacheKey, ctx.learn);

    // ③ 汇总 → 沙箱清洗 → schema 校验 → 终检
    const merged  = mergeSources(extData, dbData);
    const cleaned = await sandbox.run(ctx.learn.script, merged);
    const rows    = validateRows(cleaned, WEB_FIELDS_SCHEMA);
    supervisor.verify('final', rows, r => r.length >= 0);

    res.json({ rows, trace: supervisor.trace });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

### 6.5 各 Agent 的任务分工

| Agent | 任务 | 输入 | 输出 | 何时执行 |
|---|---|---|---|---|
| **子Agent1** `analyzeFields` | 需求分析(纯分析,**不做 function calling**) | outerHTML(FIELDS/TABLE_COLS) | 需求清单 + 字段映射(传给子Agent2/3) | 仅慢链路 |
| **子Agent2** `selectTool→callExternalAPI` | **LLM 选 Tool** + MCP-A 取数 | 字段映射 + MCP-A tool 列表 | 外部系统标准 JSON + toolPlan | 每次刷新(慢链路段含 LLM 选 Tool) |
| **子Agent3** `selectTool→query/search` | **LLM 选 Tool** + MCP-B 读写 | 字段映射 + MCP-B tool 列表/schema | 结果集/文档 + toolPlan | 每次刷新(慢链路段含 LLM 选 Tool) |
| **监管者** `verify` | 质检核验 | 各子 Agent 产物 | 达标放行 / 退回重试 | 每步之后 |

> 关键:子Agent1 只做上游分析、产物下传;子Agent2/3 的 LLM 专注 tool 选择,其「字段映射 + tool 调用计划 + 清洗脚本」**固化缓存**后,日常刷新复用计划直调 MCP、默认无 LLM 推理;监管者对每步产物质检,保证快链路毫秒级响应且质量可控。

---

## 七、模块四:MCP 服务端(A/B 双服务端)

### 7.1 职责

进阶架构拆分为**两个 MCP 服务端**,分别把不同下游封装成标准 MCP 能力,供 Agent 统一调用:

| 服务端 | 下游 | tool | resource | 被谁调用 |
|---|---|---|---|---|
| **MCP 服务端 A** | 外部系统 API | `callExternalAPI` 等 API 调用命令 | 各 API 返回数据的 JSON Schema | 子Agent2(含 LLM 选 Tool) |
| **MCP 服务端 B** | **结构化 + 非结构化数据库** | 结构化:常见 SQL 函数(`query`/`insert`/`update`/`delete`);非结构化:`search`/`get`/`put` 等文档与检索操作 | 各表的 schema + 集合/索引结构 | 子Agent3(含 LLM 选 Tool) |

### 7.2 tool 与 resource 的分工

| 类型 | 是什么 | A 示例 | B 示例 |
|---|---|---|---|
| **tool** | 可执行的动作 | `callExternalAPI(endpoint, params)` | 结构化:`query(sql, params)` / `insert(table, row)`;非结构化:`search(index, query)` / `get(collection, id)` / `put(collection, doc)` |
| **resource** | 只读的数据描述 | `external://schema/record` | `db://schema/records`(表结构)、`db://schema/events`(集合字段与索引) |

### 7.3 MCP 服务端 A 参考实现(外部系统 API)

```javascript
const { Server } = require('@modelcontextprotocol/sdk/server');

const serverA = new Server({ name: 'external-api-mcp', version: '1.0.0' });

// ── tool:调用外部系统 API ──
serverA.setRequestHandler('tools/list', async () => ({
  tools: [{
    name: 'callExternalAPI',
    description: '调用外部系统 REST API 获取业务数据(记录/明细/统计等)',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', description: '如 /list, /detail' },
        params:   { type: 'object', description: '查询参数,如{country:"德国"}' },
      },
      required: ['endpoint'],
    },
  }],
}));

serverA.setRequestHandler('tools/call', async (req) => {
  const { endpoint, params } = req.params.arguments;
  const token = await getExternalToken();              // 鉴权封装在 MCP 内部
  const url = `https://ext.example.com/api${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`External ${endpoint} 返回 ${res.status}`);
  return { content: [{ type: 'text', text: JSON.stringify(await res.json()) }] };
});

// ── resource:暴露 API 数据 schema ──
serverA.setRequestHandler('resources/list', async () => ({
  resources: [
    { uri: 'external://schema/record',  name: '记录数据结构', mimeType: 'application/json' },
    { uri: 'external://schema/detail', name: '明细数据结构', mimeType: 'application/json' },
  ],
}));

serverA.setRequestHandler('resources/read', async (req) => {
  const schema = loadSchema(req.params.uri);
  return { contents: [{ uri: req.params.uri, mimeType: 'application/json', text: JSON.stringify(schema) }] };
});
```

### 7.4 MCP 服务端 B 参考实现(结构化 + 非结构化数据库)

tool 分两类:**结构化库**走常见 SQL 函数(全部参数化),**非结构化库**走命名操作白名单(`search`/`get`/`put`,禁止任意脚本);resource 为各表 schema 与集合/索引结构(供子 Agent3 的 LLM 理解数据结构、正确选择 tool 并生成参数)。

```javascript
const { Server } = require('@modelcontextprotocol/sdk/server');
const mysql = require('mysql2/promise');
const { MongoClient } = require('mongodb');

const serverB = new Server({ name: 'db-mcp', version: '1.0.0' });
const pool = mysql.createPool({ host, user, password, database, connectionLimit: 10 });  // 结构化
const mongo = new MongoClient(mongoUri);                                                  // 非结构化(示例)

// ── tool:结构化 SQL 函数 + 非结构化命名操作 ──
serverB.setRequestHandler('tools/list', async () => ({
  tools: [
    // —— 结构化(SQL 参数化)——
    { name: 'query',  description: '结构化库只读查询,返回结果集', inputSchema: {
        type: 'object',
        properties: { sql: { type: 'string' }, params: { type: 'array' } },
        required: ['sql'] } },
    { name: 'insert', description: '结构化库向指定表插入一行', inputSchema: {
        type: 'object',
        properties: { table: { type: 'string' }, row: { type: 'object' } },
        required: ['table', 'row'] } },
    { name: 'update', description: '结构化库按条件更新行', inputSchema: {
        type: 'object',
        properties: { table: { type: 'string' }, set: { type: 'object' }, where: { type: 'object' } },
        required: ['table', 'set', 'where'] } },
    { name: 'delete', description: '结构化库按条件删除行', inputSchema: {
        type: 'object',
        properties: { table: { type: 'string' }, where: { type: 'object' } },
        required: ['table', 'where'] } },
    // —— 非结构化(命名操作白名单,禁任意脚本)——
    { name: 'search', description: '非结构化库按条件检索文档(集合/索引 + 查询条件)', inputSchema: {
        type: 'object',
        properties: { collection: { type: 'string' }, filter: { type: 'object' }, limit: { type: 'number' } },
        required: ['collection'] } },
    { name: 'get',    description: '非结构化库按 ID 取单个文档', inputSchema: {
        type: 'object',
        properties: { collection: { type: 'string' }, id: { type: 'string' } },
        required: ['collection', 'id'] } },
    { name: 'put',    description: '非结构化库写入一个文档', inputSchema: {
        type: 'object',
        properties: { collection: { type: 'string' }, doc: { type: 'object' } },
        required: ['collection', 'doc'] } },
  ],
}));

serverB.setRequestHandler('tools/call', async (req) => {
  const { name, arguments: a } = req.params;
  switch (name) {
    // —— 结构化:全部参数化,防注入 ——
    case 'query': {
      const [rows] = await pool.query(a.sql, a.params || []);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    }
    case 'insert': {
      const cols = Object.keys(a.row);
      const sql = `INSERT INTO ?? (${cols.map(() => '??').join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      const [r] = await pool.query(sql, [a.table, ...cols, ...cols.map(c => a.row[c])]);
      return { content: [{ type: 'text', text: JSON.stringify({ insertId: r.insertId }) }] };
    }
    case 'update': {
      const setKeys = Object.keys(a.set), whKeys = Object.keys(a.where);
      const sql = `UPDATE ?? SET ${setKeys.map(() => '?? = ?').join(',')} WHERE ${whKeys.map(() => '?? = ?').join(' AND ')}`;
      const args = [a.table, ...setKeys.flatMap(k => [k, a.set[k]]), ...whKeys.flatMap(k => [k, a.where[k]])];
      const [r] = await pool.query(sql, args);
      return { content: [{ type: 'text', text: JSON.stringify({ affected: r.affectedRows }) }] };
    }
    case 'delete': {
      const whKeys = Object.keys(a.where);
      const sql = `DELETE FROM ?? WHERE ${whKeys.map(() => '?? = ?').join(' AND ')}`;
      const [r] = await pool.query(sql, [a.table, ...whKeys.flatMap(k => [k, a.where[k]])]);
      return { content: [{ type: 'text', text: JSON.stringify({ affected: r.affectedRows }) }] };
    }
    // —— 非结构化:仅白名单命名操作,filter/doc 作为结构化参数传入 ——
    case 'search': {
      const docs = await mongo.db().collection(a.collection)
        .find(a.filter || {}).limit(Math.min(a.limit || 100, 500)).toArray();
      return { content: [{ type: 'text', text: JSON.stringify(docs) }] };
    }
    case 'get': {
      const doc = await mongo.db().collection(a.collection).findOne({ _id: a.id });
      return { content: [{ type: 'text', text: JSON.stringify(doc) }] };
    }
    case 'put': {
      const r = await mongo.db().collection(a.collection).insertOne(a.doc);
      return { content: [{ type: 'text', text: JSON.stringify({ insertedId: r.insertedId }) }] };
    }
    default: throw new Error(`未知数据库 tool: ${name}`);
  }
});

// ── resource:暴露表 schema 与集合/索引结构 ──
serverB.setRequestHandler('resources/list', async () => {
  const [tables] = await pool.query('SHOW TABLES');                          // 结构化:表
  const collections = await mongo.db().listCollections().toArray();          // 非结构化:集合
  return { resources: [
    ...tables.map(t => {
      const name = Object.values(t)[0];
      return { uri: `db://schema/${name}`, name: `表 ${name} 结构`, mimeType: 'application/json' };
    }),
    ...collections.map(c => ({
      uri: `db://schema/${c.name}`, name: `集合 ${c.name} 结构`, mimeType: 'application/json',
    })),
  ] };
});

serverB.setRequestHandler('resources/read', async (req) => {
  const name = req.params.uri.split('/').pop();
  const [cols] = await pool.query(
    'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_NAME = ?', [name]);
  if (cols.length) {
    return { contents: [{ uri: req.params.uri, mimeType: 'application/json', text: JSON.stringify(cols) }] };
  }
  // 非结构化:返回集合字段样例与索引信息
  const indexes = await mongo.db().collection(name).indexes();
  const sample  = await mongo.db().collection(name).findOne();
  return { contents: [{ uri: req.params.uri, mimeType: 'application/json',
    text: JSON.stringify({ fields: sample ? Object.keys(sample) : [], indexes }) }] };
});
```

### 7.5 resource(schema)示例

```json
// external://schema/record(MCP-A:外部系统返回结构)
{
  "type": "object",
  "properties": {
    "record_id":   { "type": "string" },
    "title":       { "type": "string" },
    "created_date":{ "type": "string", "format": "date" },
    "region":      { "type": "string" },
    "category":    { "type": "string" },
    "status":      { "type": "string" }
  }
}
```

```json
// db://schema/records(MCP-B:结构化数据库表结构)
[
  { "COLUMN_NAME": "id",         "DATA_TYPE": "varchar", "IS_NULLABLE": "NO",  "COLUMN_KEY": "PRI" },
  { "COLUMN_NAME": "title",      "DATA_TYPE": "varchar", "IS_NULLABLE": "NO",  "COLUMN_KEY": "" },
  { "COLUMN_NAME": "created_date","DATA_TYPE": "date",   "IS_NULLABLE": "YES", "COLUMN_KEY": "" },
  { "COLUMN_NAME": "category_id","DATA_TYPE": "int",     "IS_NULLABLE": "YES", "COLUMN_KEY": "MUL" }
]
```

```json
// db://schema/events(MCP-B:非结构化集合字段与索引)
{
  "fields": ["_id", "title", "tags", "payload", "created_at"],
  "indexes": [{ "name": "title_1", "key": { "title": 1 } }]
}
```

### 7.6 设计要点

- **A/B 职责隔离**:MCP-A 只对接外部系统 API,MCP-B 统一对接结构化与非结构化数据库,互不越权。
- **tool 描述要精确**:`description` 与 `inputSchema` 是子 Agent 2/3 的 LLM 选择 tool 的唯一依据,写清用途和参数含义。
- **鉴权/连接封装在 MCP 内部**:外部系统 Token、数据库连接串只存在对应 MCP 服务端,Agent 与前端都拿不到。
- **结构化全参数化防注入**:MCP-B 的 SQL tool 使用占位符(`??`/`?`)绑定参数,禁止字符串拼接 SQL。
- **非结构化走命名操作白名单**:`search/get/put` 只接受结构化参数(filter/doc),不执行任意脚本或原生查询串,限制返回条数。
- **读写权限分离**:建议 `query/search/get` 走只读账号,`insert/update/delete/put` 走受限写账号,并对高危操作(无 where 的 delete/update、全表/全集合扫描)拦截。
- **schema 即契约**:两端的 resource 让 LLM"看懂结构",才能正确选择 tool 并生成 API 参数、SQL 语句或检索条件。

---

## 八、安全护栏设计

LLM 生成并运行清洗脚本是全系统**最大风险点**,必须多层防护。

### 8.1 四层护栏

| 层 | 护栏 | 作用 |
|---|---|---|
| ① 输入脱敏 | SDK 剥离 `<script>` | 防 appKey/Token 随快照外泄 |
| ② 脚本沙箱 | `isolated-vm` / Worker | LLM 脚本禁网、禁文件系统、限内存/超时 |
| ③ 输出校验 | `ajv` schema 校验 | 清洗结果字段/类型不匹配则拒绝回填 |
| ④ 人工审核 | 首次脚本/tool 计划固化前人工过目 | 避免恶意/错误产物进缓存 |

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
const validate = new Ajv().compile(WEB_FIELDS_SCHEMA);

function validateRows(rows, schema) {
  if (!Array.isArray(rows)) throw new Error('清洗输出必须是数组');
  for (const r of rows) {
    if (!validate(r)) throw new Error('字段校验失败:' + JSON.stringify(validate.errors));
  }
  return rows;   // 通过才回填
}
```

### 8.4 其他安全要点

- **鉴权链**:前端 appKey → Agent 校验 → MCP 内部持有外部系统 Token 与数据库连接串,逐层收敛权限。
- **CORS**:Agent 服务端只放行页面域名。
- **审计日志**:记录每次 refresh 的 `_trace`、LLM 产物(字段映射/tool 选择/清洗脚本)、清洗结果,便于追溯。
- **速率限制**:手动 refresh 加防抖/节流,防止刷爆外部系统。

---

## 九、落地路线(MVP → 完整)

| 阶段 | 目标 | 是否用 LLM | 验收标准 |
|---|---|---|---|
| **P0** | 手写映射+清洗,SDK 直连 MCP 取外部数据回填页面 | ❌ | 数据管道跑通,页面显示真实数据 |
| **P1** | 加子 Agent1"纯分析"环节,自动产字段映射(人工审核) | ✅ 仅分析 | LLM 能正确产出字段映射表 |
| **P2** | 子 Agent2/3 LLM 选 Tool + 清洗脚本自动生成 + 沙箱执行 + schema 校验 | ✅ | tool 选择正确、脚本沙箱运行、校验拦截错误输出 |
| **P3** | 字段变更自动感知、缓存失效、多数据源(结构化+非结构化)扩展 | ✅ | 完整慢/快链路闭环,支持多外部系统与多类型数据库 |

> **强烈建议 P0 先不上大模型**:用手写映射把 `MCP → 外部系统 → 清洗 → 回填页面` 数据管道跑通,验证链路正确,再逐步引入 Agent 智能化。风险可控、每步可验证。

---

## 十、推荐目录结构

```
agentic-web-data/
├── frontend/
│   └── dashboard.html                    # 页面(引入 SDK)
├── sdk/
│   ├── src/agentic-web-data.js           # SDK 源码
│   └── dist/agentic-web-data.umd.js      # 打包产物(挂全局)
├── agent-server/                          # 多 Agent 架构
│   ├── src/
│   │   ├── index.js                       # HTTP 入口 /refresh
│   │   ├── supervisor/                     # 监管者 Agent:派发 + 质检核验 + 汇总
│   │   ├── sub-agents/
│   │   │   ├── agent1-demand.js           # 子Agent1:纯需求分析(含 LLM,不做 function calling,上游)
│   │   │   ├── agent2-mcp-a.js            # 子Agent2:含 LLM 选 Tool + 执行 MCP-A 调外部系统
│   │   │   └── agent3-mcp-b.js            # 子Agent3:含 LLM 选 Tool + 执行 MCP-B 读写数据库
│   │   ├── llm/                            # analyzeFields / selectTool / genCleanScript
│   │   ├── sandbox/                        # isolated-vm 沙箱执行
│   │   ├── cache/                          # 字段映射+tool 调用计划+脚本缓存(Redis)
│   │   └── mcp-client/                     # mcpClientA / mcpClientB 双客户端
│   └── package.json
├── mcp-server-a/                          # MCP 服务端 A:外部系统 API
│   ├── src/
│   │   ├── index.js                       # MCP Server A 启动
│   │   ├── tools/callExternalAPI.js       # 外部系统 API 调用命令
│   │   ├── resources/                      # 各 API 的 JSON Schema
│   │   └── auth/external-token.js         # 外部系统鉴权(Token 只留此处)
│   └── package.json
├── mcp-server-b/                          # MCP 服务端 B:结构化 + 非结构化数据库
│   ├── src/
│   │   ├── index.js                       # MCP Server B 启动
│   │   ├── tools/                          # 结构化 query/insert/update/delete;非结构化 search/get/put
│   │   ├── resources/                      # 表 schema(动态读 information_schema)+ 集合/索引结构
│   │   └── db/                             # 连接池与 NoSQL 客户端(连接串只留此处)
│   └── package.json
└── shared/
    └── web-fields.schema.json             # 页面字段契约(前后端共用)
```

---

## 附:一句话总览

**前端**只调 `sdk.refresh(outerHTML)` 并复用 `renderAll`;**SDK** 负责脱敏、桥接、广播;**Agent 服务端**采用多 Agent 有向分工——**监管者 Agent** 派发任务并核验每个子 Agent 的完成质量;**子Agent1** 为上游纯分析节点,分析 HTML 需要什么数据、产字段映射下传,**不做 function calling**;**子Agent2/3** 各含 LLM,负责**判断调用 MCP tool 中哪个函数**,分别经 MCP-A 调外部系统接口、经 MCP-B 读写数据库;下游拆分为 **MCP 服务端 A**(外部系统 API,tool=API 调用/resource=返回 schema)与 **MCP 服务端 B**(结构化 + 非结构化数据库,tool=SQL 函数与 search/get/put 命名操作/resource=表 schema 与集合索引结构);慢链路把「字段映射 + tool 调用计划 + 清洗脚本」一次学成并固化缓存,快链路复用计划直调 MCP、默认无 LLM 推理;全链路以"沙箱执行 + schema 校验 + 监管者质检 + 逐层鉴权 + SQL 参数化 + 非结构化操作白名单"多重护栏兜底。建议 P0 先用手写映射跑通数据管道,再分阶段引入监管者与子 Agent 智能化。
