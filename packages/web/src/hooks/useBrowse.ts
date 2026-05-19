import { useState, useEffect, useRef } from 'react'
import { browseDir } from '@/lib/api'
import type { DirEntry } from '../types'

interface BrowseState {
  entries:   DirEntry[]
  isLoading: boolean
  error:     string | null
}

const CACHE_TTL_MS = 2_000

const cache = new Map<string, { path: string; entries: DirEntry[]; fetchedAt: number }>()

export function useBrowse(deviceId: string | undefined, path: string) {
  const [state, setState] = useState<BrowseState>({ entries: [], isLoading: false, error: null })
  const [refreshKey, setRefreshKey] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!deviceId) {
      return
    }

    const cacheKey = `${deviceId}:${path}`
    const cached   = cache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      queueMicrotask(() => setState({ entries: cached.entries, isLoading: false, error: null }))
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    queueMicrotask(() => {
      if (!controller.signal.aborted) setState(s => ({ ...s, isLoading: true, error: null }))
    })

    browseDir(deviceId, path)
      .then(result => {
        if (controller.signal.aborted) return
        cache.set(cacheKey, { ...result, fetchedAt: Date.now() })
        setState({ entries: result.entries, isLoading: false, error: null })
      })
      .catch(err => {
        if (controller.signal.aborted) return
        setState({ entries: [], isLoading: false, error: err.message })
      })

    return () => controller.abort()
  }, [deviceId, path, refreshKey])

  useEffect(() => {
    if (!deviceId) return

    const refreshOnFocus = () => {
      if (document.visibilityState === 'hidden') return
      invalidateBrowseCache(deviceId, path)
      setRefreshKey(key => key + 1)
    }

    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)

    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [deviceId, path])

  const refresh = () => {
    if (deviceId) invalidateBrowseCache(deviceId, path)
    setRefreshKey(key => key + 1)
  }

  return { ...(deviceId ? state : { entries: [], isLoading: false, error: null }), refresh }
}

export function invalidateBrowseCache(deviceId: string, path?: string) {
  if (path) {
    cache.delete(`${deviceId}:${path}`)
  } else {
    for (const key of cache.keys()) {
      if (key.startsWith(`${deviceId}:`)) cache.delete(key)
    }
  }
}
