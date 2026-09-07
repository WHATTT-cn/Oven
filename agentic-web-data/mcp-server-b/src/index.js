/**
 * MCP 服务端 B 启动入口 —— 结构化 + 非结构化数据库。
 * 生产环境只支持 SSE 方式创建 MCP Server,故采用 SSEServerTransport。
 * (Q2 内将支持云环境动态部署与 NPX/UVX 本地部署托管)
 */
import 'dotenv/config';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { TOOL_DEFINITIONS, execTool } from './tools/index.js';
import { listResources, readResource } from './resources/index.js';
import { IS_MOCK } from './db/index.js';

function createServer() {
  const server = new Server(
    { name: 'db-mcp', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const result = await execTool(name, args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await listResources(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const content = await readResource(req.params.uri);
    return { contents: [content] };
  });

  return server;
}

// ── SSE transport(生产唯一支持方式) ──
const app = express();
const PORT = process.env.PORT || 4002;
const transports = new Map();

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);
  res.on('close', () => transports.delete(transport.sessionId));

  const server = createServer();
  await server.connect(transport);
});

app.post('/messages', express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(400).json({ error: '无效或已过期的 sessionId' });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.get('/health', (_req, res) => res.json({ ok: true, server: 'mcp-server-b', mock: IS_MOCK }));

app.listen(PORT, () => {
  console.log(`[mcp-server-b] SSE MCP 服务端已启动: http://localhost:${PORT}/sse (mock=${IS_MOCK})`);
});