/// <reference types="vite/client" />

import type { SnowApi } from '../preload'

declare global {
  interface Window {
    snow: SnowApi
  }
}
