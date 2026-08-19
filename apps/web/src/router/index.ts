import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      children: [
        {
          path: '',
          redirect: '/chat',
        },
        {
          path: 'chat',
          name: 'Chat',
          component: () => import('@/views/Chat.vue'),
          meta: { title: '智能问答' },
        },
        {
          path: 'graph',
          name: 'Graph',
          component: () => import('@/views/Graph.vue'),
          meta: { title: '知识图谱' },
        },
        {
          path: 'disease',
          name: 'Disease',
          component: () => import('@/views/Disease.vue'),
          meta: { title: '疾病详情' },
        },
        {
          path: 'profile',
          name: 'Profile',
          component: () => import('@/views/Profile.vue'),
          meta: { title: '个人中心' },
        },
        {
          path: 'history',
          name: 'History',
          component: () => import('@/views/History.vue'),
          meta: { title: '问答历史' },
        },
        {
          path: 'graph-manage',
          name: 'GraphManage',
          component: () => import('@/views/GraphManage.vue'),
          meta: { title: '图谱管理' },
        },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const token = localStorage.getItem('token')
  if (!to.meta.public && !token) {
    return { name: 'Login' }
  }
  if (to.meta.public && token) {
    return { name: 'Chat' }
  }
  document.title = `${to.meta.title || ''} · MediBrain-Hospital`
  return true
})

export default router
