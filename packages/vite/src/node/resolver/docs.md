# resolver

Node.js has different resolve algorithm for `require` (hereinafter, called "CJS resolver") and `import` (hereinafter, called "ESM resolver").

Spec of CJS resolver: https://nodejs.org/api/modules.html#all-together
Spec of ESM resolver: https://nodejs.org/api/esm.html#resolver-algorithm-specification

Vite needs to support both of them.

## Notes

### specifier

Specifier is a string pass to `import` in ESM or `require` in CJS.

```js
import 'foo'
import('foo')
```

```js
require('foo')
```

For example, `foo` is a specifier in this case.

CJS resolver treats specifier as a simple file path.
ESM resolver treats specifier as a URL unless it's a bare specifier.

So there's a difference between them handling special characters in URL.

### `module` field

`module` field points to a ESM file. But because Node.js doesn't use that field, there are many files that won't work with ESM resolver in wild. So it needs to use CJS resolver.

## Principle

Support all feature of ESM resolver and fallback to CJS resolver where it is possible.

## Basic Algorithm

[ESM] means that step is related to ESM resolver.
[CJS] means that step is related to CJS resolver.

_condition_: conditions to use for exports/imports

_is_windows_: whether it is running on Windows

**RESOLVE**(_id_, _importer_): (_id_, _importer_ is both path)

1. [ESM/CJS] Let _resolved_ be **undefined**.
2. [ESM/CJS] If _id_ begins with "./" or "/" or "../" or (_is_windows_ and matches /^\w:/)
   1. **PATH_RESOLVE**(_id_, _importer_)
3. [ESM/CJS] Otherwise, if _id_ begins with "#", then
   1. Set _resolved_ to the result of **PACKAGE_IMPORTS_RESOLVE**(_id_, _importer_, _condition_).
   2. **RESOLVE_ABSOLUTE**(_resolved_)
4. [ESM/CJS] Otherwise, if _id_ matches /^\w+:/, then
   1. Note: CJS doesn't support URL protocols.
   2. [ESM] If _id_ begins with "file:" or "data:" or "http:" or "https:", then
      1. [ESM] **RESOLVE_ABSOLUTE**(_id_)
   3. [ESM/CJS] Fallback to other rollup/vite plugins. STOP
5. [ESM/CJS] Otherwise,
   1. Note: _id_ is now a bare specifier.
   2. Set _resolved_ to the result of **PACKAGE_RESOLVE**(_id_, _importer_).
   3. If _resolved_ is **undefined**, fallback to other rollup/vite plugins. STOP
   4. **RESOLVE_ABSOLUTE**(_resolved_)

**RESOLVE_ABSOLUTE**(_id_):

1. [ESM] If _id_ begins with "file:", then
   1. If **fileURLToPath**(_id_) exists, resolve that. STOP
   2. Throw "not found"
2. [ESM] If _id_ begins with "data:" or "http:" or "https:", then
   1. resolve that. STOP
3. [ESM/CJS] If _id_ exists, resolve that. STOP
4. [ESM/CJS] Throw "not found"

**PATH_RESOLVE**(_id_, _importer_)

1. [ESM/CJS] Let _absolute_ be **path.resolve**(_importer_, _id_).
2. [ESM/CJS] **LOAD_AS_FILE**(_absolute_)
3. [CJS] **LOAD_AS_DIRECTORY**(_absolute_)
4. [ESM/CJS] Throw "not found"

**LOAD_AS_FILE**(_id_)

Same with LOAD_AS_FILE of CJS resolver

**LOAD_INDEX**(_id_)

Same with LOAD_INDEX of CJS resolver

**LOAD_AS_DIRECTORY**(_id_)

Same with LOAD_AS_DIRECTORY of CJS resolver

**PACKAGE_RESOLVE**(_id_, _importer_)

Similar with PACKAGE_RESOLVE of ESM resolver.

1. [ESM/CJS] Let _packageName_ be **undefined**.
2. [ESM/CJS] If _id_ is an empty string, then
   1. Fallback to other plugins. STOP
3. [ESM/CJS] If _id_ is a Node.js builtin module name, then
   1. resolve that. STOP
4. [ESM/CJS] If _id_ does not start with "@", then
   1. Set _packageName_ to the substring of _id_ until the first "/" separator or the end of the string.
5. [ESM/CJS] Otherwise,
   1. If _id_ does not contain a "/" separator, then
      1. Fallback to other plugins. STOP
   2. Set _packageName_ to the substring of _id_ until the second "/" separator or the end of the string.
6. [ESM/CJS] Let _packageSubpath_ be "." concatenated with the substring of _id_ from the position at the length of _packageName_.
7. [ESM/CJS] Let _selfPath_ be the result of **PACKAGE_SELF_RESOLVE**(_packageName_, _packageSubpath_, **pathToFileURL**(_importer_)).
8. [ESM/CJS] If _selfPath_ is not **undefined**, return _selfPath_
9. [ESM/CJS] Let _resolved_ be result of **LOAD_NODE_MODULES**(_packageName_, _packageSubpath_, _importer_).
10. [ESM/CJS] If _resolved_ is not **undefined**, return _resolved_
11. [ESM/CJS] Fallback to other plugins. STOP

**PACKAGE_SELF_RESOLVE**(_packageName_, _packageSubpath_, _importer_)

Same with PACKAGE_SELF_RESOLVE of ESM resolver. Note this corresponds to LOAD_PACKAGE_SELF of CJS resolver.

**LOAD_NODE_MODULES**(_packageName_, _packageSubpath_, _importer_)

Similar with LOAD_NODE_MODULES of CJS resolver.

1. [ESM/CJS] Let _dirs_ to be result of **NODE_MODULES_PATHS**(**path.dir**(_importer_)).
2. [ESM/CJS] For each _dir_ in _dirs_,
   1. **LOAD_PACKAGE_EXPORTS**(_packageName_, _packageSubpath_, _dir_)
   2. If _packageSubpath_ is not ".", then
      1. **LOAD_AS_FILE**(_dir_ + _packageName_ + _packageSubpath_)
   3. **LOAD_AS_DIRECTORY**(_dir_ + _packageName_ + _packageSubpath_)

**NODE_MODULES_PATHS**(_dir_)

Similar with NODE_MODULES_PATHS of CJS resolver.

1. [ESM/CJS] let _parts_ = path split(_dir_)
2. [ESM/CJS] let _i_ = count of _parts_ - 1
3. [ESM/CJS] let _dirs_ = []
4. [ESM/CJS] while _i_ >= 0,
   1. if _parts_\[_i_\] = "node_modules" continue
   2. _dir_ = path join(_parts_[0 .. *i*] + "node_modules")
   3. _dirs_ = _dir_ + _dirs_
   4. _i_ = _i_ - 1
5. [ESM/CJS] return _dirs_

**LOAD_PACKAGE_EXPORTS**(_packageName_, _packageSubpath_, _dir_)

Similar with LOAD_PACKAGE_EXPORTS of CJS resolver.

1. Let _packageDir_ to be _dir_ + _packageName_
2. Let _pjson_ be the result of **READ_PACKAGE_JSON**(_packageDir_).
3. If _pjson_ is not **null** and _pjson.exports_ is not **null** or **undefined**, then
   1. Return the result of **PACKAGE_EXPORTS_RESOLVE**(_packageDir_, _packageSubpath_, _pjson.exports_, _conditions_).

**PACKAGE_IMPORTS_RESOLVE**(_id_, _importer_, _condition_)

Same with PACKAGE_IMPORTS_RESOLVE of ESM resolver except the param takes path instead of URL.

**PACKAGE_EXPORTS_RESOLVE**(_id_, _importer_, _condition_)

Same with PACKAGE_EXPORTS_RESOLVE of ESM resolver except the param takes path instead of URL.

**READ_PACKAGE_JSON**(_packageDir_)

Same with PACKAGE_SELF_RESOLVE of ESM resolver except the param takes path instead of URL.

## Caveats

### extension

CJS resolver supports omitting extension and omitting `/index` part.
ESM resolver doesn't support that, but Vite core support this in some cases.

### virtual packages: invalid package name

CJS resolver supports using invalid package name used with bare specifier.

Example:

```js
require('@foo')
```

This is not supported by ESM resolver. Vite core won't support this.

### virtual packages: single file

CJS resolver supports using a single file instead of a directory containing a package.

Example:

```
- node_modules
  - foo.js
- file.js
```

```js
// file.js
require('foo') // this resolves to node_modules/foo.js
```

This is not supported by ESM resolver. Vite core won't support this.

### nested package.json

CJS resolver supports `package.json` inside a directory in a package.

Example:

```
- node_modules
  - foo
    - bar
      - package.json # main field has "main.js"
      - main.js
    - package.json
- file.js
```

```js
// file.js
require('foo/bar') // resolves to node_modules/foo/bar/main.js
```

This is **not** supported by ESM resolver. **Vite core does support this.**

### global node_modules paths (`NODE_PATH`)

CJS resolver supports global node_modules paths (`NODE_PATH`).

This is not supported by ESM resolver as you can see from the spec. [Also will not likely be supported](https://github.com/nodejs/node/issues/38128#issuecomment-814859663).

Vite core won't support this.
