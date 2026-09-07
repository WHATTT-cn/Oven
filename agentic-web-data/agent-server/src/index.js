/**
 * Agent 服务端入口(含 LLM 的唯一模块)。
 *
 * 暴露 HTTP 接口:
 *   POST /refresh  —— SDK 携带脱敏后的 HTML,触发监管者流水线,返回 rows + trace
 *   GET  /health   —— 健康检查
 *
 * 编排:Supervisor(慢/快链路)→ agent1 分析 / agent2+3 取数 → 沙箱清洗 → schema 校验。
 *
 * ⚠️ 生产改造要点:
 *   - CORS 收敛到可信来源(当前允许所有来源,仅便于联调)
 *   - 关闭各 USE_MOCK_* 开关,接真实 LLM / MCP-A / MCP-B / Redis
 *   - 增加鉴权(校验 X-App-Key)与请求体大小限制
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import express from 'express';
import cors from 'cors';

import { Supervisor } from './supervisor/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

// 加载 shared 字段契约(前后端共用)
async function loadWebFieldsSchema() {
  // ⚠️ 硬编码相对路径:agent-server/src → ../../shared
  const schemaPath = path.resolve(
    __dirname,
    '../../shared/web-fields.schema.json'
  );
  const raw = await readFile(schemaPath, 'utf-8');
  return JSON.parse(raw);
}

async function main() {
  const webFieldsSchema = await loadWebFieldsSchema();
  const supervisor = new Supervisor(webFieldsSchema);

  const app = express();
  // ⚠️ CORS 允许所有来源:仅联调用,生产需收敛为白名单
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  /**
   * /refresh:SDK POST { html, intentA?, intentB? }
   * 返回 { ok, rows, trace }
   */
  app.post('/refresh', async (req, res) => {
    try {
      const { html, intentA, intentB } = req.body || {};
      if (!html) {
        return res.status(400).json({ ok: false, error: '缺少 html' });
      }
      // ⚠️ 生产:此处应校验 req.header('X-App-Key') 鉴权
      const { rows, trace } = await supervisor.refresh({
        html,
        intentA,
        intentB,
      });
      return res.json({ ok: true, rows, trace });
    } catch (err) {
      console.error('[refresh] 失败:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`[agent-server] 监听 http://localhost:${PORT}`);
    console.log(
      `[agent-server] mock 开关 => LLM:${process.env.USE_MOCK_LLM ?? 'true'} ` +
        `SANDBOX:${process.env.USE_MOCK_SANDBOX ?? 'true'} ` +
        `CACHE:${process.env.USE_MOCK_CACHE ?? 'true'}`
    );
  });
}

main().catch((err) => {
  console.error('[agent-server] 启动失败:', err);
  process.exit(1);
});