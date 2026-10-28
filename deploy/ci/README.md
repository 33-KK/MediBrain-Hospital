# CI/CD 流水线（骨架）

> 当前先定义结构，等后端代码落地后再完善实际 job。

## GitLab CI 示例

```yaml
# .gitlab-ci.yml（根目录）—— 移到根目录后启用
stages:
  - lint
  - build
  - docker
  - deploy

lint:
  stage: lint
  image: node:24-alpine
  script:
    - npm ci
    - npm run lint

docker:
  stage: docker
  image: docker:latest
  only:
    - main
  script:
    - docker build -f deploy/docker/web.Dockerfile -t registry:5000/medibrain-web:${CI_COMMIT_SHORT_SHA} .
    - docker build -f deploy/docker/server.Dockerfile -t registry:5000/medibrain-server:${CI_COMMIT_SHORT_SHA} .
    - docker push registry:5000/medibrain-web:${CI_COMMIT_SHORT_SHA}
    - docker push registry:5000/medibrain-server:${CI_COMMIT_SHORT_SHA}
```

## 说明

- 一期不接 CI；代码能本地起。
- 二期接 GitLab Runner 推镜像，四期触发 K8s 滚动更新。
