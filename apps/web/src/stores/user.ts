import { defineStore } from 'pinia'
import { authApi, type UserInfo } from '@/api'

function cachedUser(): UserInfo | null {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    return user && typeof user.username === 'string'
      ? { userId: user.userId, username: user.username }
      : null
  } catch {
    localStorage.removeItem('user')
    return null
  }
}

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: cachedUser(),
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
  },
  actions: {
    async login(username: string, password: string) {
      const res = (await authApi.login({ username, password })) as any
      this.token = res.token
      this.user = res.user as UserInfo
      localStorage.setItem('token', res.token)
      localStorage.setItem('user', JSON.stringify(res.user))
    },
    async register(username: string, password: string) {
      const res = (await authApi.register({ username, password })) as any
      this.token = res.token
      localStorage.setItem('token', res.token)
      await this.refreshProfile()
    },
    async refreshProfile() {
      this.user = await authApi.profile() as UserInfo
      localStorage.setItem('user', JSON.stringify(this.user))
    },
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    },
  },
})
