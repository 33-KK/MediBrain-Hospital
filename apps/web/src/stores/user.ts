import { defineStore } from 'pinia'
import { authApi, type UserInfo } from '@/api'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: JSON.parse(localStorage.getItem('user') || 'null') as UserInfo | null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    role: (s) => s.user?.role || '',
  },
  actions: {
    async login(username: string, password: string) {
      const res = (await authApi.login({ username, password })) as any
      this.token = res.token
      this.user = res.user as UserInfo
      localStorage.setItem('token', res.token)
      localStorage.setItem('user', JSON.stringify(res.user))
    },
    async register(username: string, password: string, identity?: string) {
      const res = (await authApi.register({ username, password, identity })) as any
      this.token = res.token
      localStorage.setItem('token', res.token)
    },
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    },
  },
})
