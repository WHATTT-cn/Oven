/**
 * 双 MCP 客户端:通过 SSE transport 连接 MCP 服务端 A / B。
 * 生产环境只支持 SSE 方式创建 MCP Server,客户端相应使用 SSEClientTransport。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

class McpClient {
  constructor(name, sseUrl) {
    this.name = name;
    this.sseUrl = sseUrl;
    this.client = null;
    this._connecting = null;
  }

  async _ensure() {
    if (this.client) return this.client;
    if (this._connecting) return this._connecting;

    this._connecting = (async () => {
      const transport = new SSEClientTransport(new URL(this.sseUrl));
      const client = new Client(
        { name: `agent-client-${this.name}`, version: '1.0.0' },
        { capabilities: {} }
      );
      await client.connect(transport);
      this.client = client;
      return client;
    })();

    return this._connecting;
  }

  /** 列出 tool(供 LLM 选择) */
  async listTools() {
    const client = await this._ensure();
    const res = await client.listTools();
    return res.tools || [];
  }

  /** 列出 resource */
  async listResources() {
    const client = await this._ensure();
    const res = await client.listResources();
    return res.resources || [];
  }

  /** 读取 resource schema */
  async readResource(uri) {
    const client = await this._ensure();
    return client.readResource({ uri });
  }

  /**
   * 调用 tool,返回解析后的 JSON(MCP content[0].text 反序列化)。
   */
  async callTool(name, args) {
    const client = await this._ensure();
    const res = await client.callTool({ name, arguments: args || {} });
    const text = res?.content?.[0]?.text;
    try {
      return text ? JSON.parse(text) : res;
    } catch {
      return text;
    }
  }
}

export const mcpClientA = new McpClient('a', process.env.MCP_A_SSE_URL || 'http://localhost:4001/sse');
export const mcpClientB = new McpClient('b', process.env.MCP_B_SSE_URL || 'http://localhost:4002/sse');