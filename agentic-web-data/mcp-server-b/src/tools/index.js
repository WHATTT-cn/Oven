/**
 * MCP 服务端 B 的 tool 集合:
 * - 结构化(SQL,全部参数化防注入):query / insert / update / delete
 * - 非结构化(命名操作白名单,禁任意脚本):search / get / put
 */
import { getPool, getMongo } from '../db/index.js';

export const TOOL_DEFINITIONS = [
  // —— 结构化 ——
  {
    name: 'query',
    description: '结构化库只读查询,返回结果集(SQL 需参数化)',
    inputSchema: {
      type: 'object',
      properties: { sql: { type: 'string' }, params: { type: 'array' } },
      required: ['sql'],
    },
  },
  {
    name: 'insert',
    description: '结构化库向指定表插入一行',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, row: { type: 'object' } },
      required: ['table', 'row'],
    },
  },
  {
    name: 'update',
    description: '结构化库按条件更新行(where 不能为空)',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, set: { type: 'object' }, where: { type: 'object' } },
      required: ['table', 'set', 'where'],
    },
  },
  {
    name: 'delete',
    description: '结构化库按条件删除行(where 不能为空)',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, where: { type: 'object' } },
      required: ['table', 'where'],
    },
  },
  // —— 非结构化 ——
  {
    name: 'search',
    description: '非结构化库按条件检索文档(集合 + 过滤条件)',
    inputSchema: {
      type: 'object',
      properties: { collection: { type: 'string' }, filter: { type: 'object' }, limit: { type: 'number' } },
      required: ['collection'],
    },
  },
  {
    name: 'get',
    description: '非结构化库按 ID 取单个文档',
    inputSchema: {
      type: 'object',
      properties: { collection: { type: 'string' }, id: { type: 'string' } },
      required: ['collection', 'id'],
    },
  },
  {
    name: 'put',
    description: '非结构化库写入一个文档',
    inputSchema: {
      type: 'object',
      properties: { collection: { type: 'string' }, doc: { type: 'object' } },
      required: ['collection', 'doc'],
    },
  },
];

// 只读语句校验:query tool 只允许 SELECT,防写操作绕过
function assertReadOnly(sql) {
  if (!/^\s*select\b/i.test(sql)) {
    throw new Error('query 仅允许 SELECT 语句');
  }
}

// 防危险操作:update/delete 必须带非空 where
function assertHasWhere(where) {
  if (!where || Object.keys(where).length === 0) {
    throw new Error('禁止无 where 条件的 update/delete');
  }
}

/**
 * 执行数据库 tool。
 * @param {string} name
 * @param {object} a arguments
 * @returns {Promise<object>} 结果(未包装 content)
 */
export async function execTool(name, a) {
  const pool = getPool();
  const mongo = getMongo();

  switch (name) {
    // —— 结构化:全部参数化 ——
    case 'query': {
      assertReadOnly(a.sql);
      const [rows] = await pool.query(a.sql, a.params || []);
      return rows;
    }
    case 'insert': {
      const cols = Object.keys(a.row);
      const sql = `INSERT INTO ?? (${cols.map(() => '??').join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      const [r] = await pool.query(sql, [a.table, ...cols, ...cols.map((c) => a.row[c])]);
      return { insertId: r.insertId };
    }
    case 'update': {
      assertHasWhere(a.where);
      const setKeys = Object.keys(a.set);
      const whKeys = Object.keys(a.where);
      const sql = `UPDATE ?? SET ${setKeys.map(() => '?? = ?').join(',')} WHERE ${whKeys.map(() => '?? = ?').join(' AND ')}`;
      const args = [a.table, ...setKeys.flatMap((k) => [k, a.set[k]]), ...whKeys.flatMap((k) => [k, a.where[k]])];
      const [r] = await pool.query(sql, args);
      return { affected: r.affectedRows };
    }
    case 'delete': {
      assertHasWhere(a.where);
      const whKeys = Object.keys(a.where);
      const sql = `DELETE FROM ?? WHERE ${whKeys.map(() => '?? = ?').join(' AND ')}`;
      const [r] = await pool.query(sql, [a.table, ...whKeys.flatMap((k) => [k, a.where[k]])]);
      return { affected: r.affectedRows };
    }

    // —— 非结构化:命名操作白名单 ——
    case 'search': {
      const docs = await mongo.db().collection(a.collection)
        .find(a.filter || {}).limit(Math.min(a.limit || 100, 500)).toArray();
      return docs;
    }
    case 'get': {
      return mongo.db().collection(a.collection).findOne({ _id: a.id });
    }
    case 'put': {
      const r = await mongo.db().collection(a.collection).insertOne(a.doc);
      return { insertedId: r.insertedId };
    }

    default:
      throw new Error(`未知数据库 tool: ${name}`);
  }
}