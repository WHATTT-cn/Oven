# AgenticWebData

多 Agent 协同 + 双 MCP 服务端的 Web 数据接入系统骨架。

- 监管者 Agent(Supervisor):拆解任务、调度子 Agent、质检核验、不合格退回重试
- 子Agent1(分析师·纯分析):分析 HTML 产字段映射,不做 function calling
- 子Agent2(外部系统执行器·含 LLM):LLM 判断调 MCP-A 哪个 tool
- 子Agent3(数据库执行器·含 LLM):LLM 判断调 MCP-B 哪个 tool
- 双 MCP 解耦:MCP-A 封装外部 API,MCP-B 封装结构化 + 非结构化数据库

## 目录结构

```
agentic-web-data/
├── frontend/dashboard.html          前端页面(无 LLM):展示/触发刷新/接收回填
├── sdk/                           SDK 层(无 LLM):脱敏、请求、广播变更
│   └── src/agentic-web-data.js
├── agent-server/                    Agent 服务端(唯一含 LLM)
│   └── src/
│       ├── index.js                 HTTP 入口 /refresh
│       ├── supervisor/              监管者:慢/快链路编排 + 质检
│       ├── sub-agents/              agent1 分析 / agent2 MCP-A / agent3 MCP-B
│       ├── llm/                     analyzeFields/selectTool/genCleanScript(含 mock)
│       ├── sandbox/                 清洗脚本沙箱(isolated-vm / vm 降级)
│       ├── cache/                   慢/快链路缓存(Redis / 内存降级)
│       └── mcp-client/              双 MCP 客户端(SSEClientTransport)
├── mcp-server-a/                    MCP-A(无 LLM):tool=callExternalAPI
│   └── src/{index.js, tools/, resources/, auth/external-token.js}
├── mcp-server-b/                    MCP-B(无 LLM):query/insert/update/delete + search/get/put
│   └── src/{index.js, tools/, resources/, db/}
└── shared/web-fields.schema.json    前后端共用字段契约(JSON Schema)
```

## 数据流(单向)

```
onChange → state.rows → renderAll
```

前端触发刷新 → SDK 脱敏 HTML → POST agent-server `/refresh` → Supervisor 编排
(agent1 分析 → 生成清洗脚本;agent2+agent3 并行取数)→ 沙箱清洗 → schema 校验 → 回填

## 生产约束(重要)

- **当前生产环境只支持 SSE 方式创建 MCP Server**,故服务端统一用 `SSEServerTransport`、客户端统一用 `SSEClientTransport`。
- Q2 内将支持云环境动态部署与 NPX/UVX 本地部署托管,届时可切换其它 transport。

## 本地联调(默认全 mock,无需真实依赖)

各服务默认开启 `USE_MOCK_*`,可在无数据库/LLM/Redis 时直接跑通管道。

```bash
# 1) MCP-A(默认端口 4001)
cd mcp-server-a && npm install && npm start

# 2) MCP-B(默认端口 4002,USE_MOCK_DB=true 走内存)
cd mcp-server-b && npm install && npm start

# 3) Agent 服务端(默认端口 3000,USE_MOCK_LLM/SANDBOX/CACHE=true)
cd agent-server && npm install && npm start

# 4) 前端:用任意静态服务器打开 frontend/dashboard.html
```

> 注:`agent-server` 的 `isolated-vm` 为原生模块需要编译工具链;
> 联调阶段 `USE_MOCK_SANDBOX=true` 时走内置 `vm`,可先不安装 `isolated-vm`。

## 环境变量

各模块 `.env.example` 已列出所需变量,复制为 `.env` 后按需修改:

- `agent-server`:`PORT`、`USE_MOCK_LLM/SANDBOX/CACHE`、`LLM_*`、`REDIS_URL`、`MCP_A_SSE_URL`、`MCP_B_SSE_URL`
- `mcp-server-a`:`PORT`、外部系统 `EXTERNAL_API_BASE`、`EXTERNAL_API_TOKEN`
- `mcp-server-b`:`PORT`、`USE_MOCK_DB`、`MYSQL_*`、`MONGO_URL`

## 安全护栏(四层)

1. SDK 剥离 `<script>`
2. isolated-vm 沙箱(禁网/禁 FS/限内存/超时)
3. ajv schema 校验
4. 首次脚本 / tool 计划人工审核后再缓存

## 落地路线

- P0 手写映射跑通管道(无 LLM)
- P1 加子Agent1 分析
- P2 子Agent2/3 选 Tool + 清洗脚本 + 沙箱 + 校验
- P3 字段变更感知 + 缓存失效 + 多数据源




AgenticWebData 项目已完整搭建(shared/frontend/sdk/mcp-server-a/mcp-server-b/agent-server,全部 ESM,含 README)。以下为需关注的代码清单与生产改造指南。

一、硬编码 / 占位密钥

frontend/dashboard.html: endpoint='http://localhost:3000/refresh'、appKey='DEV_APP_KEY_PLACEHOLDER'
agent-server/llm: LLM_API_KEY_PLACEHOLDER、LLM_API_BASE='https://api.example-llm.com/v1'
agent-server/cache: REDIS_URL='redis://localhost:6379'
agent-server/mcp-client: MCP_A/B SSE 默认 localhost:4001/4002
mcp-server-a: EXTERNAL_API_TOKEN=REPLACE_WITH_REAL_TOKEN;mcp-server-b: MYSQL/MONGO 连接串
默认端口 3000/4001/4002
二、示例代码

frontend seedRows 演示数据;llm 三个 mock 函数(analyzeFields/selectTool/genCleanScript);sandbox 恒等清洗脚本;各 resources 示例 schema;external-token 伪 OAuth。
三、测试环境代码

开关 USE_MOCK_LLM/SANDBOX/CACHE/DB 全为 true;sandbox 走 node:vm(非安全边界);cache 走内存 Map;mcp-server-b 内存 mock;无凭据时返回占位 token。
四、生产改造指南

关闭所有 USE_MOCK_*;密钥全部走环境变量/密钥管理服务,禁止明文
接真实 LLM / MCP-A / MCP-B / Redis;安装并编译 isolated-vm(需工具链)
CORS 收敛白名单;加 X-App-Key 鉴权;请求体限流
首次 plan/清洗脚本经人工审核后再固化缓存(护栏第④层)
MCP Server 仅支持 SSE 部署;NPX/UVX 与云动态部署为 Q2 规划
风险:代码未经运行时校验(本机无 node),建议在 node 环境执行 npm install + node --check 后联调。