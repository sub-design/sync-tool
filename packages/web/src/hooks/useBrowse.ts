import { useState, useEffect, useRef } from 'react'
import { browseDir } from '@/lib/api'
import type { DirEntry } from '../types'

interface BrowseState {
  entries:   DirEntry[]
  isLoading: boolean
  error:     string | null
}

const cache = new Map<string, { path: string; entries: DirEntry[] }>()

export function useBrowse(deviceId: string | undefined, path: string) {
  const [state, setState] = useState<BrowseState>({ entries: [], isLoading: false, error: null })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!deviceId) {
      setState({ entries: [], isLoading: false, error: null })
      return
    }

    const cacheKey = `${deviceId}:${path}`
    const cached   = cache.get(cacheKey)
    if (cached) {
      setState({ entries: cached.entries, isLoading: false, error: null })
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState(s => ({ ...s, isLoading: true, error: null }))

    browseDir(deviceId, path)
      .then(result => {
        if (controller.signal.aborted) return
        cache.set(cacheKey, result)
        setState({ entries: result.entries, isLoading: false, error: null })
      })
      .catch(err => {
        if (controller.signal.aborted) return
        setState({ entries: [], isLoading: false, error: err.message })
      })

    return () => controller.abort()
  }, [deviceId, path])

  return state
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
