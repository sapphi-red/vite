/extensions/: resolve.extensions を上書きしてるせい
/hmr/: `import.meta.hot.accept('./hmrDep')`を`import.meta.hot.accept('./hmrDep.js')`にすると動きそう、拡張子のありなしで動いてない
/optimize-deps/: いろいろ
/resolve/
/vue/: ts を js で読み込むのが動いてない
/vue-jsx/: ts を js で読み込むのが動いてない
/worker/: ts を js で読み込むのが動いてない
