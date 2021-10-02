import type { Plugin, ViteDevServer } from 'vite'
import { createFilter } from '@rollup/pluginutils'
import { ResolvedPluginContext } from './types'
import { defaultExclude, defaultInclude, getHash } from './utils'

const VIRTUAL_PREFIX = '/@miniwind/'
const SCOPE_IMPORT_RE = / from (['"])(@miniwind\/scope)\1/

export function ModuleScopePlugin({ generate, options }: ResolvedPluginContext): Plugin {
  const moduleMap = new Map<string, [string, string]>()
  let server: ViteDevServer | undefined

  const filter = createFilter(
    options.include || defaultInclude,
    options.exclude || defaultExclude,
  )

  const invalidate = (hash: string) => {
    if (!server)
      return
    const id = `${VIRTUAL_PREFIX}${hash}.css`
    const mod = server.moduleGraph.getModuleById(id)
    if (!mod)
      return
    server.moduleGraph.invalidateModule(mod)
    server.ws.send({
      type: 'update',
      updates: [{
        acceptedPath: id,
        path: id,
        timestamp: +Date.now(),
        type: 'js-update',
      }],
    })
  }

  return {
    name: 'miniwind:module-scope',
    enforce: 'post',
    configureServer(_server) {
      server = _server
    },
    async transform(code, id) {
      if (id.endsWith('.css') || !filter(id))
        return

      const hash = getHash(id)
      const hasScope = code.match(SCOPE_IMPORT_RE)

      const style = await generate(code, id, hasScope ? `.${hash}` : undefined)
      if (!style && !hasScope)
        return null

      if (hasScope)
        code = code.replace(SCOPE_IMPORT_RE, ` from 'data:text/javascript;base64,${Buffer.from(`export default () => "${hash}"`).toString('base64')}'`)

      moduleMap.set(hash, [id, style])
      invalidate(hash)

      return {
        code: `import "${VIRTUAL_PREFIX}${hash}.css";${code}`,
        map: null,
      }
    },
    resolveId(id) {
      return id.startsWith(VIRTUAL_PREFIX) ? id : null
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX))
        return null

      const hash = id.slice(VIRTUAL_PREFIX.length, -'.css'.length)

      const [source, css] = moduleMap.get(hash) || []

      if (source)
        this.addWatchFile(source)

      return `\n/* miniwind ${source} */\n${css}`
    },
  }
}