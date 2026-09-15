# Oven · Agentic 自适应Web数据接入工具

> 让大模型看懂前端页面需要什么字段，自动从外部系统 / 数据库取数、清洗，并回填到看板 —— **前端零配置、后端自适应**。

---

## 📖 产品简介

**Oven** 是一套 Agent 驱动的自适应Web数据接入解决方案。前端页面只需调用一次 `sdk.refresh(outerHTML)`，系统即可自动理解看板所需字段，从 外部 API、结构化 / 非结构化数据库等来源取数、清洗成页面可用格式并回填显示，**渲染逻辑零改动**。

### ✨ 核心价值

| 能力 | 说明 |
|---|---|
| **前端零配置** | 只需引入 SDK、注册 `onChange`、加一个刷新按钮，`renderAll` 等渲染代码完全不动 |
| **后端自适应** | 大模型读懂页面结构，自动产出字段映射、Tool 调用计划与清洗脚本 |
| **慢/快链路分离** | 字段与脚本"学一次缓存"，日常刷新复用缓存直调数据源，毫秒级响应、成本可控 |
| **单向数据流** | 数据统一走 `onChange → state.rows → renderAll`，逻辑清晰、易维护 |
| **多重安全护栏** | 输入脱敏 + 沙箱执行 + Schema 校验 + 人工审核，逐层收敛权限 |

### 🧩 架构方案

- **AgenticWebData**：多 Agent 协同 + 双 MCP 服务端 —— 监管者 Agent 统筹质检，子 Agent 分工（纯分析 / 选 Tool 调外部 API / 选 Tool 读写数据库），支持结构化与非结构化多数据源。

### 🏗️ 系统架构

```
前端页面  →  SDK(脱敏/桥接/广播)  →  Agent 服务端(理解+编排+清洗)  →  MCP 服务端(数据源封装)
   ↑                                                                          │
   └──────────────  onChange → state.rows → renderAll  ←── 标准 rows[] ────────┘
```

### 🛡️ 四层安全护栏

1. **输入脱敏**：SDK 剥离内联 `<script>`，防 appKey / Token 随快照外泄
2. **脚本沙箱**：`isolated-vm` 隔离 LLM 生成脚本，禁网禁文件系统、限内存与超时
3. **输出校验**：`ajv` 按 JSON Schema 校验清洗结果，字段/类型不符则拒绝回填
4. **人工审核**：首次脚本与 Tool 计划固化缓存前人工过目

---

## 🎬 在线演示


- **[Oven产品开放麦demo展示幻灯片](https://weblinkpre.ok.kimi.link/)**

---

## 📑 幻灯片快照

<img src="pictures/第01页.png" alt="第01页" width="800" />


<img src="pictures/第02页.png" alt="第02页" width="800" />


<img src="pictures/第03页.png" alt="第03页" width="800" />


<img src="pictures/第04页.png" alt="第04页" width="800" />


<img src="pictures/第05页.png" alt="第05页" width="800" />


<img src="pictures/第06页.png" alt="第06页" width="800" />


<img src="pictures/第07页.png" alt="第07页" width="800" />


<img src="pictures/第08页.png" alt="第08页" width="800" />


<img src="pictures/第09页.png" alt="第09页" width="800" />


<img src="pictures/第10页.png" alt="第10页" width="800" />


<img src="pictures/第11页.png" alt="第11页" width="800" />


<img src="pictures/第12页.png" alt="第12页" width="800" />


<img src="pictures/第13页.png" alt="第13页" width="800" />


<img src="pictures/第14页.png" alt="第14页" width="800" />