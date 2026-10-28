# 给老师演示 MediBrain

采用本机运行加临时 HTTPS 分享链接，无需购买云服务器或域名。所有账号统一登录；系统提供只读图谱和个人问答历史，不再提供角色、用户管理或图谱增删改。

## 启动与停止

当前网络下 Cloudflare Quick Tunnel 和 localhost.run 均未通过远程访问验证，已关闭失败进程，尚无可分享的有效链接。本机项目、普通演示账号和资料验收正常；正在准备 cpolar 免费随机域名方案。

首次使用：在 [cpolar 官网](https://dashboard.cpolar.com/) 注册并登录免费账号，在“验证”页面复制认证令牌。然后在项目目录的 PowerShell 中执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\maintenance\configure-teacher-demo.ps1
```

仅将令牌粘贴到本机隐藏输入框，不在聊天中发送。令牌保存在项目忽略的 `data/demo/cpolar.yml`，不会作为进程参数传递。工具已从官方签名安装包中提取，不安装系统服务，也未创建 SSH 或远程桌面隧道。

先启动 Docker Desktop，确保本机项目健康。完成认证后启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\maintenance\start-teacher-demo-cpolar.ps1
```

启动成功后，将输出的临时网址与 `data/demo/teacher-access.txt` 中的账号单独发给老师。无需发送项目源码或数据库密码。重复执行会复用本次仍在运行且验证通过的链接。

停止公网分享：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\maintenance\stop-teacher-demo.ps1
```

这只停止本次隧道，不会关闭 Docker 或删除项目数据。以后重新启动隧道会得到新网址。

## 演示顺序

1. 登录，展示智能问答、疾病检索、知识图谱、医学资料库及个人历史。
2. 提问“高血压不能吃什么”，查看图谱事实和对应来源。
3. 提问“脑卒中有哪些食养指南”，查看资料卡片并打开 PDF 分页原文。
4. 在医学资料库中检索“高血压”或“Asthma”，展示中文资料与英文原始摘要。
5. 在问答页测试语音播放和自己的问答历史。

新入库资料的专业审核状态仍为待审核；演示应说明系统如何区分参考资料和图谱事实。

## 使用条件

- 演示期间电脑保持开机联网，Docker、项目和 Ollama 持续运行；电脑休眠或断网会影响访问。
- 当前只映射本机网页入口，未向公网开放数据库或模型端口。
- cpolar 免费版为随机域名、1 Mbps 带宽，域名可能变化；访问速度取决于双方网络，正式分享前应让老师所在网络试开链接。当前账号认证待完成，尚未验证 cpolar 的公网登录与问答。
- 登录认证和资料 API 需要账号。临时链接本身可被转发，演示结束后运行停止脚本关闭入口。

参考：[cpolar 免费套餐](https://www.cpolar.com/pricing)、[cpolar 官方文档](https://www.cpolar.com/docs)。`start-teacher-demo.ps1` 保留为 Cloudflare 备用方案，目前网络验证失败。
