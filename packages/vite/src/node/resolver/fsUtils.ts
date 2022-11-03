import type { PathLike, Stats } from 'node:fs'
import fs from 'node:fs/promises'

/**
 * fs.readFile but returns undefined when not found
 */
export async function fsReadFile(path: PathLike): Promise<string | undefined> {
  // TODO: maybe we shouldn't use try-catch for perf
  try {
    return await fs.readFile(path, 'utf-8')
  } catch {}
}

/**
 * fs.stat but returns undefined when not found
 */
export async function fsStat(path: PathLike): Promise<Stats | undefined> {
  // TODO: maybe we shouldn't use try-catch for perf
  try {
    return await fs.stat(path)
  } catch {}
}
