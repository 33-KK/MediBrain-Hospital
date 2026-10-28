# 统一登录与角色功能移除

日期：2026-10-14。

## 最终行为

- 注册仅填写用户名和密码，所有账号使用同一套功能。
- 登录、JWT、个人中心、问答和个人历史不再使用或展示角色/医疗身份。
- 移除用户管理、角色授权、管理员初始化、图谱增删改及其接口；只读图谱与疾病查询保留。
- 问答历史仅按当前登录账号查询、删除、清空，无法通过旧管理员 token 或 `all=true` 查看他人记录。
- 旧账号继续使用原密码；旧 token 中额外的角色字段被忽略；原先停用的账号仍不能登录。
- 保留图谱检索的冲突保护、答案事实约束、资料待审核标记和后台索引任务处理。

## 历史数据

已在部署数据库完成清理：4 个账号和 37 条问答历史的旧 `role`、`identity` 字段已移除，原字段已备份到忽略目录 `data/backups/`。数据库清理脚本仅移除分类元数据，不删除账号或问答正文、不改密码或启用状态。代码仍兼容尚未迁移的旧记录。

本轮已依次执行以下命令，真实部署验收已通过。以后迁移其他环境时，必须先核实数据库目标并等全部旧后端 Pod 退出，再执行：

```powershell
node scripts/maintenance/remove-user-classification.cjs
node scripts/maintenance/remove-user-classification.cjs --apply
node scripts/diagnostics/single-user.cjs
```

迁移结果见 `docs/acceptance/user-login-migration-latest.json`，实际部署验收见 `docs/acceptance/single-user-latest.json`。

## 验证与发布结果

- 后端 14 个套件、91 项单元测试通过，新增旧账号/旧 token 兼容及历史隔离检查，移除了仅适用于已删除功能的测试。
- 13 项离线回归检查、1 项接口测试通过；后端 lint、后端构建、前端类型检查与构建通过。
- 已在本机静态预览中检查注册页，仅包含用户名、密码和注册按钮；截图为 `docs/screenshots/single-login-register-2026-10-14.png`。此检查不代表真实后端注册验收。
- 真实 MongoDB/Redis 临时容器集成测试通过，临时容器已清理。
- 实际部署验收通过：无分类的注册/JWT、旧账号密码兼容、管理接口 404、个人历史隔离、医学资料与只读疾病查询；测试账号与记录已清理。
- 已在真实部署页面核对导航与个人中心，没有角色、医疗身份或管理入口。截图为 `docs/screenshots/single-login-deployed-2026-10-14.png`。
- 前后端已发布到 `kind-medibrain-prod` 的 `medibrain` 命名空间，各 2 个副本就绪。后端镜像为 `medibrain-server:single-login-20261014-tts`，前端为 `medibrain-web:single-login-20261014`。
- 生产 smoke 测试通过：依赖健康、图谱事实问答、1024 维向量与候选检索、历史持久化、管理接口移除、真实 MP3 合成。结果见 `docs/acceptance/production-smoke-2026-10-14.jsonl`。

## 运行环境恢复

Docker 已由用户启动，服务端版本为 29.8.2。原本 `sailor-ingest.sock` 的启动故障当前未再阻塞项目。kind 原本的本机端口 `61954` 被 Windows 拒绝绑定，保留数据重启控制节点也未恢复该映射。

当前使用 `medibrain-kind-api-relay` 容器恢复本机集群连接，监听 `127.0.0.1:16443`，TLS 原样透传到 kind 控制节点，仍由既有 Kubernetes 证书认证。该容器配置 `unless-stopped`，只读文件系统、普通 node 用户、无 Linux capabilities；仅挂载 `scripts/maintenance/kind-api-relay.cjs`。工作区 `kubeconfig-prod.utf8` 已更新到新端口，未修改全局 kubeconfig 或集群密钥。

网页地址为 `http://localhost:8090`。电脑重启后先启动 Docker，再运行 `scripts/maintenance/start-local-access.ps1 -Dependencies`。该脚本显式使用项目 kubeconfig/context，只有匹配本项目配置的已有转发才会复用。

如果自行删除转发容器，可从仓库根目录重新创建：

```powershell
docker run --detach --name medibrain-kind-api-relay --restart unless-stopped --network kind --publish 127.0.0.1:16443:6443 --read-only --cap-drop ALL --security-opt no-new-privileges --memory 64m --cpus 0.25 --user node --mount "type=bind,source=$((Get-Location).Path)/scripts/maintenance/kind-api-relay.cjs,target=/relay.cjs,readonly" --entrypoint node node:24-alpine /relay.cjs
```

本轮还发现原镜像缓存的 edge-tts 7.2.8 被外部语音接口返回 403。官方 [7.3.0/7.3.1 发布说明](https://github.com/rany2/edge-tts/releases)包含协议更新；已在 Dockerfile 固定至 7.3.1，临时容器验证后滚动发布，生产接口成功返回 14,256 字节 MP3。该语音功能仍依赖外部服务联网。
