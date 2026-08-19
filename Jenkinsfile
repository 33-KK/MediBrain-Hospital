// ============================================================
// MediBrain-Hospital Jenkins 流水线
// 阶段: lint -> test -> build(docker) -> push -> deploy(k8s)
// 依赖 Jenkins 凭据:
//   - kubeconfig:      K8s 集群 kubeconfig 文件 (类型: Secret file)
//   - server-env:      后端 .env (类型: Secret file)
// 镜像仓库: 本地 Docker daemon 上的 registry (localhost:5000)
// ============================================================

pipeline {
  agent any

  environment {
    REGISTRY = 'localhost:5000/medibrain'
    IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT?.take(8)}"
  }

  stages {
    stage('Checkout') {
      steps { checkout scm }
    }

    stage('Lint & Build') {
      agent { docker { image 'node:20-alpine' } }
      steps {
        dir('apps/server') {
          sh 'npm ci'
          sh 'npm run build'
        }
        dir('apps/web') {
          sh 'npm ci'
          sh 'npm run build'
        }
      }
    }

    stage('Docker Build & Push') {
      steps {
        script {
          docker.withRegistry('http://localhost:5000') {
            def web = docker.build("${REGISTRY}/medibrain-web:${IMAGE_TAG}", "--build-arg VERSION=${IMAGE_TAG} -f deploy/docker/web.Dockerfile .")
            def server = docker.build("${REGISTRY}/medibrain-server:${IMAGE_TAG}", "--build-arg VERSION=${IMAGE_TAG} -f deploy/docker/server.Dockerfile .")
            web.push()
            server.push()
            web.push('latest')
            server.push('latest')
          }
        }
      }
    }

    stage('Deploy to K8s') {
      steps {
        script {
          // 本地 kind 环境：将镜像导入集群节点（真实集群可移除本步）
          sh '''
            if kind get clusters 2>/dev/null | grep -q medibrain; then
              kind load docker-image ${REGISTRY}/medibrain-server:${IMAGE_TAG} --name medibrain
              kind load docker-image ${REGISTRY}/medibrain-web:${IMAGE_TAG} --name medibrain
            fi
          '''
        }
        withCredentials([file(credentialsId: 'kubeconfig', variable: 'KUBECONFIG')]) {
          sh '''
            # kind 本地环境：kubeconfig 指向 127.0.0.1，需改为宿主机可达地址
            sed -i 's|https://127.0.0.1:[0-9]*|https://host.docker.internal:63061|' ${KUBECONFIG}
            sed -i 's|^    certificate-authority-data:|    insecure-skip-tls-verify: true\n    #certificate-authority-data:|' ${KUBECONFIG}
            kubectl -n medibrain set image deployment/medibrain-server server=${REGISTRY}/medibrain-server:${IMAGE_TAG}
            kubectl -n medibrain set image deployment/medibrain-web web=${REGISTRY}/medibrain-web:${IMAGE_TAG}
            kubectl -n medibrain rollout status deployment/medibrain-server --timeout=300s
            kubectl -n medibrain rollout status deployment/medibrain-web --timeout=300s
          '''
        }
      }
    }
  }

  post {
    success { echo 'MediBrain-Hospital 部署成功' }
    failure { echo '流水线失败，请检查构建日志' }
  }
}
