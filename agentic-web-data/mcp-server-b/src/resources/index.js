/**
 * MCP 服务端 B 的 resource:动态读取表 schema(information_schema)+ 集合字段/索引结构。
 * schema 即契约,供子 Agent3 的 LLM 理解结构、正确选择 tool 并生成参数。
 */
import { getPool, getMongo } from '../db/index.js';

/**
 * 列出所有可读结构:结构化表 + 非结构化集合。
 */
export async function listResources() {
  const pool = getPool();
  const mongo = getMongo();

  const [tables] = await pool.query('SHOW TABLES');
  const collections = await mongo.db().listCollections().toArray();

  return [
    ...tables.map((t) => {
      const name = Object.values(t)[0];
      return { uri: `db://schema/${name}`, name: `表 ${name} 结构`, mimeType: 'application/json' };
    }),
    ...collections.map((c) => ({
      uri: `db://schema/${c.name}`,
      name: `集合 ${c.name} 结构`,
      mimeType: 'application/json',
    })),
  ];
}

/**
 * 读取单个结构:优先当作结构化表读列信息,读不到则当作非结构化集合读字段/索引。
 * @param {string} uri  形如 db://schema/records
 */
export async function readResource(uri) {
  const name = uri.split('/').pop();
  const pool = getPool();
  const mongo = getMongo();

  const [cols] = await pool.query(
    'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_NAME = ?',
    [name]
  );

  if (cols && cols.length) {
    return { uri, mimeType: 'application/json', text: JSON.stringify(cols) };
  }

  // 非结构化:返回集合字段样例与索引
  const indexes = await mongo.db().collection(name).indexes();
  const sample = await mongo.db().collection(name).findOne();
  return {
    uri,
    mimeType: 'application/json',
    text: JSON.stringify({ fields: sample ? Object.keys(sample) : [], indexes }),
  };
}