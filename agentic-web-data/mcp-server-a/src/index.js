/**
 * MCP 服务端 A 启动入口 —— 封装外部系统 API。
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

import { TOOL_DEFINITION, callExternalAPI } from './tools/callExternalAPI.js';
import { RESOURCE_LIST, loadSchema } from './resources/schemas.js';

function createServer() {
  const server = new Server(
    { name: 'external-api-mcp', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  // ── tool:列出 / 调用 ──
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [TOOL_DEFINITION],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (name !== 'callExternalAPI') {
      throw new Error(`未知 tool: ${name}`);
    }
    const data = await callExternalAPI(args);
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  });

  // ── resource:列出 / 读取 schema ──
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCE_LIST,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const schema = loadSchema(uri);
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(schema) }],
    };
  });

  return server;
}

// ── SSE transport(生产唯一支持方式) ──
const app = express();
const PORT = process.env.PORT || 4001;

// 保存活跃的 SSE 连接,按 sessionId 路由 POST 消息
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

app.get('/health', (_req, res) => res.json({ ok: true, server: 'mcp-server-a' }));

app.listen(PORT, () => {
  console.log(`[mcp-server-a] SSE MCP 服务端已启动: http://localhost:${PORT}/sse`);
});