export function tryWithAndWithoutPostfix<
  Importer extends string | void,
  Opts extends object | boolean | void,
  Result extends { id: string } | { error: string } | null
>(
  func: (id: string, importer: Importer, opts: Opts) => Promise<Result>
): (
  id: string,
  importer: Importer,
  opts: Opts
) => Promise<Result | { error: string } | null> {
  return async (id, importer, opts) => {
    const errors: string[] = []

    // first resolve normally
    const resolved = await func(id, importer, opts)
    if (resolved) {
      if ('error' in resolved) {
        errors.push(resolved.error)
      } else {
        return resolved
      }
    }

    const { file, postfix } = splitFileAndPostfix(id)
    // if it failed, resolve without postfix
    if (postfix !== '') {
      const resolved = await func(file, importer, opts)
      if (resolved) {
        if ('error' in resolved) {
          errors.push(resolved.error)
        } else {
          resolved.id += postfix
          return resolved
        }
      }
    }

    if (errors.length > 0) {
      return { error: errors.join('\n') }
    }

    return null
  }
}

function splitFileAndPostfix(path: string) {
  let file = path
  let postfix = ''

  let postfixIndex = path.indexOf('?')
  if (postfixIndex < 0) {
    postfixIndex = path.indexOf('#')
  }
  if (postfixIndex > 0) {
    file = path.slice(0, postfixIndex)
    postfix = path.slice(postfixIndex)
  }
  return { file, postfix }
}
