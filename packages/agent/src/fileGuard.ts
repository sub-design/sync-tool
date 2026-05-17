import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveUserPath } from './pathVariables'

export interface AllowedPath {
  inputPath: string
  resolvedPath: string
}

const FILE_URL_PREFIX = 'file://'

export function isLocalEndpoint(location: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(location) || location.startsWith(FILE_URL_PREFIX)
}

export async function assertAllowedLocalEndpoint(location: string): Promise<AllowedPath | undefined> {
  if (!isLocalEndpoint(location)) return undefined
  return assertAllowedPath(location)
}

export async function assertAllowedPath(inputPath: string): Promise<AllowedPath> {
  const resolvedPath = resolveUserPath(inputPath)
  const [candidate, roots] = await Promise.all([
    realPathForAuthorization(resolvedPath),
    allowedRoots(),
  ])

  if (!roots.some((root) => isPathInside(candidate.realPath, root.realPath))) {
    throw new Error(`Path is outside allowed roots: ${inputPath}`)
  }

  return { inputPath, resolvedPath: candidate.resolvedPath }
}

async function allowedRoots(): Promise<Array<{ rootPath: string; realPath: string }>> {
  const configured = (process.env.SYNC_ALLOWED_ROOTS ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  const roots = [os.homedir(), ...configured].map((root) => resolveUserPath(root))
  const uniqueRoots = [...new Set(roots)]
  const result: Array<{ rootPath: string; realPath: string }> = []

  for (const rootPath of uniqueRoots) {
    const root = await realPathForAuthorization(rootPath)
    result.push({ rootPath: root.resolvedPath, realPath: root.realPath })
  }

  return result
}

async function realPathForAuthorization(inputPath: string): Promise<{ resolvedPath: string; realPath: string }> {
  const resolvedPath = path.resolve(inputPath)
  try {
    return { resolvedPath, realPath: await fs.promises.realpath(resolvedPath) }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err
  }

  const existingAncestor = await nearestExistingAncestor(resolvedPath)
  const ancestorRealPath = await fs.promises.realpath(existingAncestor)
  const suffix = path.relative(existingAncestor, resolvedPath)
  return {
    resolvedPath,
    realPath: suffix ? path.join(ancestorRealPath, suffix) : ancestorRealPath,
  }
}

async function nearestExistingAncestor(inputPath: string): Promise<string> {
  let current = path.resolve(inputPath)
  while (true) {
    try {
      const stat = await fs.promises.stat(current)
      if (stat.isDirectory()) return current
      return path.dirname(current)
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err
    }

    const parent = path.dirname(current)
    if (parent === current) throw new Error(`No existing ancestor for path: ${inputPath}`)
    current = parent
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}
