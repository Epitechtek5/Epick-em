import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

import { tokenStore } from '@/lib/auth/token-store'

afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})
