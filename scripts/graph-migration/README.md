# 图谱数据迁移

将本机 Neo4j 开发库的图谱数据（节点 + 关系）完整迁移到目标 Neo4j（如 K8s 集群内实例）。

## 原理

1. **导出**：连接源 Neo4j，按节点/关系分两类生成标准化 Cypher 语句（`graph-dump.cypher`）
   - 节点语句：`MERGE (:标签 {属性...})`（幂等）
   - 关系语句：`MATCH (a:起点标签 {名称: "x"}), (b:终点标签 {名称: "y"}) MERGE (a)-[:关系类型 {属性...}]->(b)`（幂等）
2. **导入**：连接目标 Neo4j，批量事务执行（每批 50 条），失败批次回滚并计数，可重跑

## 使用

```bash
cd scripts/graph-migration
# 先在 apps/server 执行 npm ci；脚本自动复用它的依赖并读取项目 .env。
# 源库密码使用 SRC_PASS 或 NEO4J_PASSWORD；目标库必须另外设置 DST_PASS。

# 1. 导出（源库默认 bolt://localhost:7687）
node export.js                    # 默认输出 graph-dump.cypher

# 2. 导入（目标库默认 bolt://localhost:7688）
node import4.js graph-dump.cypher
```

连接信息通过环境变量覆盖：

| 变量 | 默认 | 说明 |
|------|------|------|
| SRC_URI | bolt://localhost:7687 | 源库地址 |
| SRC_USER / SRC_PASS | neo4j / 无默认密码 | 源库凭据；SRC_PASS 可回退到 NEO4J_PASSWORD |
| DST_URI | bolt://localhost:7688 | 目标库地址（本地 7688 → 集群 7687 的 port-forward） |
| DST_USER / DST_PASS | neo4j / 无默认密码 | 目标库凭据；DST_PASS 可回退到 PASS |

## 批量导入注意点

- **事务内存**：关系量大（30 万级）时，目标库需调大事务内存，否则 OOM：
  ```yaml
  NEO4J_server_memory_heap_max__size: 2G
  NEO4J_server_memory_heap_initial__size: 512m
  NEO4J_server_memory_pagecache_size: 512m
  NEO4J_dbms_memory_transaction_total_max: 2G
  ```
- **语句语法陷阱**：Cypher 中 `(a疾病 {...})` 会被解析为**单个变量名** `a疾病`，而非"变量 a + 标签 疾病"。关系语句必须写成 `MATCH (a:疾病 {名称:...}), (b:食物 {名称:...})` 并统一使用变量 `a`、`b`。否则 MATCH 绑定的变量与 CREATE/MERGE 使用的变量不一致，会静默创建空标签节点。
- **幂等**：节点/关系均用 MERGE，重复导入不会产生重复数据；导入前可手动清空（见下）。

## 校验

导入完成后建议比对数量：

`node verify.js` 使用同一组源库与目标库环境变量核对节点、关系和空标签数量。

```cypher
MATCH (n) RETURN count(n)          -- 源库 49278，目标应一致
MATCH ()-[r]->() RETURN count(r)   -- 源库 303046，目标应一致
MATCH (n) WHERE labels(n)=[] RETURN count(n)  -- 应为 0（空标签节点）
```

## 文件说明

| 文件 | 说明 |
|------|------|
| export.js | 源库导出（节点 MERGE + 关系 MATCH/MERGE） |
| import4.js | 目标库导入（批量事务、幂等） |
| graph-dump.cypher | 导出产物（约 35 万行，352324 条语句） |
| import-run.log | 最近一次导入日志 |
