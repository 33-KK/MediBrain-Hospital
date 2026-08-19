#!/usr/bin/env bash
# ============================================================
# MediBrain-Hospital 真实集群一键部署
# 依赖: kubectl, KUBECONFIG, REGISTRY, OLLAMA_HOST, MILVUS_HOST
# 用法:
#   export KUBECONFIG=/path/to/kubeconfig
#   export REGISTRY=registry.example.com/medibrain
#   export OLLAMA_HOST=192.168.1.100
#   export MILVUS_HOST=192.168.1.100
#   bash deploy/k8s/production/deploy-prod.sh
# ============================================================
set -euo pipefail

: "${KUBECONFIG:?请设置 KUBECONFIG}"
: "${REGISTRY:?请设置 REGISTRY (私有镜像仓库)}"
: "${OLLAMA_HOST:?请设置 OLLAMA_HOST (Ollama 服务器内网 IP)}"
: "${MILVUS_HOST:?请设置 MILVUS_HOST (Milvus 服务器内网 IP)}"
: "${IMAGE_TAG:=latest}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
K8S="$ROOT/deploy/k8s"

echo "==> 1/6 命名空间"
kubectl apply -f "$K8S/namespace.yaml"

echo "==> 2/6 基础设施 (Neo4j / Mongo / Redis)"
kubectl apply -f "$K8S/infra/neo4j.yaml" -f "$K8S/infra/mongo.yaml" -f "$K8S/infra/redis.yaml"
kubectl rollout status statefulset/medibrain-neo4j -n medibrain --timeout=600s
kubectl rollout status statefulset/medibrain-mongo -n medibrain --timeout=600s

echo "==> 3/6 配置与密钥"
kubectl apply -f "$K8S/configmap.yaml"
kubectl apply -f "$K8S/secret.yaml"

echo "==> 4/6 server (注入 hostAliases 生产清单)"
sed -e "s|registry.example.com/medibrain/medibrain-server:latest|${REGISTRY}/medibrain-server:${IMAGE_TAG}|" \
    -e "s|192.168.1.100|${OLLAMA_HOST}|" \
    "$DIR/server-deployment.prod.yaml" | kubectl apply -f -

echo "==> 5/6 web + Ingress"
sed -e "s|localhost:5000/medibrain/medibrain-web:v1.2.0|${REGISTRY}/medibrain-web:${IMAGE_TAG}|" \
    "$K8S/web/deployment.yaml" | kubectl apply -f -
kubectl apply -f "$K8S/web/service.yaml" -f "$K8S/web/ingress.yaml"

echo "==> 6/6 等待就绪"
kubectl -n medibrain rollout status deployment/medibrain-server --timeout=600s
kubectl -n medibrain rollout status deployment/medibrain-web --timeout=600s

echo ""
echo "==> 健康检查"
kubectl -n medibrain get pods -o wide
echo "部署完成！请配置 Ingress 域名解析后访问。"