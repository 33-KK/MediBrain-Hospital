# 真实集群部署（生产 K8s）

> 本目录面向**真实云服务器集群**（非 kind 本地环境）。
> 本地 kind 集群使用 `host.docker.internal` 直连宿主机 Ollama/Milvus，
> 真实集群需通过 **hostAliases** 将外部服务域名映射到服务器内网 IP。

## 一、架构差异（kind vs 生产）

| 项 | kind 本地 | 真实集群 |
|----|-----------|----------|
| Neo4j / Mongo / Redis | 集群内 StatefulSet | 集群内 StatefulSet（同 manifest） |
| Ollama（bge-m3） | 宿主机 `host.docker.internal:11434` | 独立服务器/同机，hostAliases 映射 |
| Milvus | 宿主机 `host.docker.internal:19540` | 独立服务器/同机，hostAliases 映射 |
| 镜像仓库 | `localhost:5000`（本机 registry） | 私有镜像仓库（Harbor 等） |
| kubeconfig | 本地文件 | 集群管理员证书 |

## 二、hostAliases 配置

`apps/server` Pod 需要通过域名访问外部 Ollama / Milvus。
在 server Deployment 的 `spec.template.spec` 增加：

```yaml
hostAliases:
  - ip: "192.168.1.100"        # 替换为 Ollama/Milvus 所在服务器内网 IP
    hostnames:
      - "host.docker.internal" # 保持配置不变，仅替换 IP
```

已提供生产 manifest：`deploy/k8s/production/server-deployment.prod.yaml`
（基于本地版本派生，含 hostAliases 占位与镜像仓库变量）。

## 三、一键部署脚本

`deploy/k8s/production/deploy-prod.sh` 完成：

1. 校验 `KUBECONFIG` 与 `REGISTRY` 环境变量
2. 创建 namespace / ConfigMap / Secret / 基础设施（Neo4j、Mongo、Redis）
3. 部署 server（注入 hostAliases 与生产 Secret）
4. 部署 web + Ingress
5. 等待 rollout 完成并输出健康检查

### 用法

```bash
# 在具备 kubectl 权限的服务器上
export KUBECONFIG=/path/to/kubeconfig
export REGISTRY=registry.example.com/medibrain   # 私有仓库地址
export OLLAMA_HOST=192.168.1.100                 # Ollama 服务器内网 IP
export MILVUS_HOST=192.168.1.100                 # Milvus 服务器内网 IP
bash deploy/k8s/production/deploy-prod.sh
```

首次部署且集群尚无 `medibrain-secret` 时，指定已填好真实值的 `SECRET_FILE`。脚本拒绝占位符，并保留已有集群的 Secret。配置中的 Ollama 和 Milvus 地址分别使用 `OLLAMA_HOST` / `MILVUS_HOST`。

## 四、前置准备清单

- [ ] 云服务器 ≥ 4 核 16G（Neo4j + Mongo + Redis + 2 副本 server）
- [ ] Ollama（bge-m3 模型）与 Milvus 已部署并开放内网端口
- [ ] 私有镜像仓库（Harbor）且已推送 `medibrain-server` / `medibrain-web`
- [ ] Ingress Controller（nginx-ingress）已安装
- [ ] 生产 Secret 已生成（JWT_SECRET、NEO4J_AUTH、MONGO_URI 等）

## 五、安全注意事项

- 所有外部端口禁止暴露公网（仅内网）
- Milvus / Ollama 需防火墙白名单
- 生产环境建议启用 TLS（Ingress annotations）
- 镜像拉取使用 imagePullSecrets（私有仓库认证）

## 六、模拟环境验证记录（2026-08-19）

本流程已在本地 kind 模拟生产集群（`medibrain-prod`，3 节点）完整跑通：

| 步骤 | 结果 |
|------|------|
| deploy-prod.sh 1-6 步 | 全部通过（Neo4j/Mongo/Redis + server + web） |
| 图谱数据迁移 | 49439 节点 / 303293 关系（`scripts/graph-migration`，0 失败） |
| 登录 / Profile / Health | 200 |
| 5 病种问答（高血压/糖尿病/冠心病/胃溃疡/类风湿） | 全部 201 命中图谱 |
| 历史记录 | 正常记录 |
| 限流（30 次/分） | 25×200 + 10×429，符合预期 |

**模拟中修复的问题（已合入生产 manifest）**：
1. `server-deployment.prod.yaml` 缺少 `REDIS_HOST: medibrain-redis` 环境变量 → 已补充（缺失会导致 Redis 连接失败、健康检查不过、Pod 反复重启）
2. 模拟环境适配点（仅模拟需要，真实集群不受影响）：
   - 镜像名改为本机 `localhost:5000` 并 `kind load`（真实集群用 Harbor + imagePullSecrets）
   - hostAliases IP 改为 `192.168.65.254`（Docker Desktop host-gateway，真实集群替换为服务器内网 IP）
   - 模拟集群需先创建 Mongo 用户与导入 Neo4j 数据（真实集群同此步骤）
