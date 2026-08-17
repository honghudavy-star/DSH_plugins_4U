import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import test from 'node:test'
import vm from 'node:vm'

const ROOT = resolve(import.meta.dirname, '..')
const PACKAGES = ['wechat', 'wallpaper', 'vision']

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('all packages declare a DSH Host bundle and Cordis patch', () => {
  for (const id of PACKAGES) {
    const dir = join(ROOT, 'packages', id)
    const manifest = json(join(dir, 'package.json'))
    assert.equal(manifest.name, `@dsh-plugins/${id}`)
    assert.equal(manifest.main, './index.mjs')
    assert.equal(manifest.exports['.'], './index.mjs')
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
    assert.notEqual(manifest.bin?.[`dsh-plugins-${id}`]?.includes('install'), true)
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, new RegExp(`name: ['"]?@dsh-plugins/${id}['"]?`))
  }
})

test('repository root is an installable DSH umbrella bundle', async () => {
  const manifest = json(join(ROOT, 'package.json'))
  assert.equal(manifest.name, '@dsh-plugins/4u')
  assert.equal(manifest.main, './index.mjs')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'))
  const rootPatch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(rootPatch, /name: ['"]@dsh-plugins\/4u['"]/) // root Loader row

  const host = await import('../index.mjs')
  assert.equal(host.name, 'dsh-plugins-4u')
  assert.equal(typeof host.apply, 'function')
})

test('umbrella client registers a custom plugins tab containing exactly three plugins', () => {
  let loaded
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: value => [value, () => {}],
    useEffect: () => {},
  }
  const source = readFileSync(join(ROOT, 'client.js'), 'utf8')
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { loaded = value } } },
  })
  assert.equal(loaded.id, '@dsh-plugins/4u')
  const plugin = loaded.factory(specifier => {
    assert.equal(specifier, 'react')
    return react
  })
  assert.deepEqual(Array.from(plugin.plugins, item => item.packageName), [
    '@dsh-plugins/wechat',
    '@dsh-plugins/wallpaper',
    '@dsh-plugins/vision',
  ])

  let slotName
  let options
  plugin.apply({
    slots: {
      inject: (name, setup) => { slotName = name; setup() },
      register: (value) => { options = value; return () => {} },
    },
  })
  assert.equal(slotName, 'settings.plugins.tab')
  assert.equal(options.name, 'settings.plugins.tab')
  assert.equal(options.id, 'dsh-plugins-4u')
  assert.equal(options.label, '自定义插件')

  let toggled = false
  const card = plugin.PluginCard({
    plugin: plugin.plugins[0],
    expanded: false,
    onToggle: () => { toggled = true },
  })
  const button = card.children.find(child => child?.type === 'button')
  assert.equal(button.props['aria-expanded'], false)
  assert.equal(button.props['aria-controls'], 'dsh-plugin-details-wechat')
  button.props.onClick()
  assert.equal(toggled, true)
  assert.equal(plugin.plugins.every(item => item.endpoint.startsWith('/plugins/dsh-') && item.fields.length >= 3), true)
  assert.deepEqual(Array.from(plugin.plugins, item => item.endpoint), [
    '/plugins/dsh-wechat/config',
    '/plugins/dsh-wallpaper/config',
    '/plugins/dsh-vision/config',
  ])
  const wallpaperPlugin = plugin.plugins.find(item => item.id === 'wallpaper')
  assert.equal(wallpaperPlugin.fields.some(field => field.key === 'localFile' && field.type === 'file'), true)

  const page = plugin.CustomPluginsPage()
  const list = page.children.find(child => child?.type === 'div' && child.props?.style?.gridTemplateColumns === '1fr')
  assert.ok(list, 'plugin page should render one full-width accordion column')
})

test('client packages expose DSH ModuleLoader bundles with declared dependencies', () => {
  for (const id of ['wechat', 'vision']) {
    const dir = join(ROOT, 'packages', id)
    const manifest = json(join(dir, 'package.json'))
    assert.equal(manifest.exports['./client'], './client.js')
    assert.equal(manifest.dsh.client.platform, 'web')
    assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))

    let loaded
    const source = readFileSync(join(dir, 'client.js'), 'utf8')
    vm.runInNewContext(source, {
      window: { __ModuleLoader__: { load: value => { loaded = value } } },
      queueMicrotask,
      btoa: value => Buffer.from(value, 'binary').toString('base64'),
      fetch: async () => { throw new Error('unused') },
      Uint8Array,
      Error,
    })
    assert.equal(loaded.id, `@dsh-plugins/${id}`)
    const plugin = loaded.factory(specifier => {
      assert.equal(specifier, 'react')
      return { createElement: () => null, Fragment: Symbol('Fragment'), useRef: value => ({ current: value }), useState: () => [false, () => {}] }
    })
    assert.equal(typeof plugin.apply, 'function')

    let slot
    plugin.apply({
      slots: {
        inject: (name, setup) => { slot = name; setup() },
        register: () => () => {},
      },
      sessions: { open: () => {} },
      conversation: { draftImages: () => [] },
    })
    assert.equal(slot, id === 'wechat' ? 'sidebar.footer.action' : 'conversation.input.right')
  }
})

test('wallpaper Host plugin injects one managed style without mutating DSH files', async () => {
  const { injectWallpaper } = await import('../packages/wallpaper/index.mjs')
  const html = injectWallpaper('<html><head></head><body></body></html>', {
    source: 'preset:midnight',
    opacity: 0.4,
    stateFile: '',
    maxImageBytes: 10 * 1024 * 1024,
  })
  assert.match(html, /id="dsh-plugins-wallpaper"/)
  assert.match(html, /opacity:0\.4/)
  assert.equal((html.match(/id="dsh-plugins-wallpaper"/g) || []).length, 1)
})

test('wallpaper upload accepts real supported image bytes and rejects disguised files', async () => {
  const { validateUploadedImage } = await import('../packages/wallpaper/index.mjs')
  const png = readFileSync(join(ROOT, 'packages', 'wallpaper', 'presets', 'midnight.png'))
  assert.equal(validateUploadedImage(png, 'image/png'), '.png')
  assert.throws(() => validateUploadedImage(Buffer.from('not an image'), 'image/png'), /does not match/)
  assert.throws(() => validateUploadedImage(png, 'image/svg+xml'), /does not match/)
})

test('wallpaper off can remove only the complete legacy runtime patch', async () => {
  const { stripLegacyWallpaperPatch } = await import('../packages/wallpaper/legacy-cleanup.mjs')
  const marker = '/* DSH_WALLPAPER_MARKER_START */'
  const end = '/* DSH_WALLPAPER_MARKER_END */'
  const source = `before\n${marker}\nlegacy wallpaper\n${end}\nafter`
  assert.deepEqual(stripLegacyWallpaperPatch(source), {
    source: 'before\n\nafter',
    changed: true,
  })
  assert.deepEqual(stripLegacyWallpaperPatch('clean bundle'), {
    source: 'clean bundle',
    changed: false,
  })
  assert.throws(() => stripLegacyWallpaperPatch(`${marker}\nincomplete`), /不完整/)
})

test('Host plugin modules expose Cordis apply functions', async () => {
  for (const id of PACKAGES) {
    const plugin = await import(`../packages/${id}/index.mjs`)
    assert.equal(plugin.name, `dsh-plugins-${id}`)
    assert.equal(typeof plugin.apply, 'function')
    assert.deepEqual(plugin.inject, ['webServer'])
  }
})

test('all three Host configuration controllers persist live, namespaced settings', async () => {
  const registrations = []
  const makeContext = () => ({
    inject: (dependencies, setup) => {
      assert.deepEqual(dependencies, ['settings'])
      setup({
        settings: {
          register: (namespace, _schema, options) => {
            let current = { ...options.base }
            const watchers = new Set()
            registrations.push({ namespace, options })
            return {
              get: () => current,
              update: async patch => {
                const previous = current
                current = { ...current, ...patch }
                for (const watcher of watchers) await watcher(current, previous)
              },
              watch: watcher => {
                watchers.add(watcher)
                return () => watchers.delete(watcher)
              },
            }
          },
        },
      })
    },
  })

  let wechatChanges = 0
  const { createWechatConfigController } = await import('../packages/wechat/index.mjs')
  const wechat = createWechatConfigController(makeContext(), { enabled: true, bridgePort: 8790 }, () => { wechatChanges += 1 })
  assert.equal((await wechat.update({ bridgePort: 8791 })).bridgePort, 8791)
  assert.equal(wechatChanges, 1)

  const { createWallpaperConfigController } = await import('../packages/wallpaper/index.mjs')
  const wallpaper = createWallpaperConfigController(makeContext(), { enabled: true, source: 'preset:midnight', opacity: 0.3 })
  assert.equal((await wallpaper.update({ opacity: 0.45 })).opacity, 0.45)

  const { createVisionConfigController } = await import('../packages/vision/index.mjs')
  const vision = createVisionConfigController(makeContext(), { apiKeyEnv: 'SILICONFLOW_API_KEY', model: 'deepseek-ai/DeepSeek-OCR' })
  assert.equal((await vision.update({ model: 'example/vision' })).model, 'example/vision')

  assert.deepEqual(registrations.map(item => [item.namespace, item.options.applies]), [
    ['dsh-plugins-wechat', 'live'],
    ['dsh-plugins-wallpaper', 'live'],
    ['dsh-plugins-vision', 'live'],
  ])
})

test('wallpaper Host controller cleans legacy patches on startup and live changes', async () => {
  let current = { enabled: false, source: 'preset:midnight', opacity: 0.3 }
  const watchers = new Set()
  let cleanupCalls = 0
  const reasons = []
  const ctx = {
    inject: (_dependencies, setup) => setup({
      settings: {
        register: () => ({
          get: () => current,
          update: async patch => {
            const previous = current
            current = { ...current, ...patch }
            for (const watcher of watchers) await watcher(current, previous)
          },
          watch: watcher => {
            watchers.add(watcher)
            return () => watchers.delete(watcher)
          },
        }),
      },
    }),
    logger: { warn: () => {} },
  }
  const { createWallpaperConfigController } = await import('../packages/wallpaper/index.mjs')
  const controller = createWallpaperConfigController(
    ctx,
    current,
    reason => reasons.push(reason),
    () => {
      cleanupCalls += 1
      return cleanupCalls === 1
    },
  )

  assert.equal(cleanupCalls, 1)
  await controller.update({ enabled: true })
  assert.equal(cleanupCalls, 2)
  assert.deepEqual(reasons, ['legacy wallpaper patch removed'])
})

test('WeChat supervisor detects an occupied bridge port before spawning', async t => {
  const blocker = createServer()
  await new Promise((resolve, reject) => {
    blocker.once('error', reject)
    blocker.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => { if (blocker.listening) blocker.close() })
  const address = blocker.address()
  assert.equal(typeof address, 'object')

  const { isBridgePortAvailable } = await import('../packages/wechat/index.mjs')
  assert.deepEqual(await isBridgePortAvailable(address.port), { available: false, code: 'EADDRINUSE' })
  await new Promise((resolve, reject) => blocker.close(error => error ? reject(error) : resolve()))
  assert.deepEqual(await isBridgePortAvailable(address.port), { available: true })
})

test('WeChat security helpers enforce private token, safe files, and one-use origins', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-wechat-security-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { loadOrCreateBridgeToken, OriginRegistry, resolveOutboundFile } = await import('../packages/wechat/src/security.mjs')

  const { token, file: tokenFile } = loadOrCreateBridgeToken(dir)
  assert.match(token, /^[A-Za-z0-9._~-]{32,}$/)
  assert.equal(statSync(dir).mode & 0o777, 0o700)
  assert.equal(statSync(tokenFile).mode & 0o777, 0o600)
  assert.throws(() => loadOrCreateBridgeToken(dir, 'too-short'), /at least 32/)

  const outbound = join(dir, 'result.txt')
  writeFileSync(outbound, 'ok')
  assert.equal(resolveOutboundFile(outbound), realpathSync(outbound))
  assert.throws(() => resolveOutboundFile('relative.txt'), /absolute path/)
  assert.throws(() => resolveOutboundFile(dir), /regular file/)
  const link = join(dir, 'result-link.txt')
  symlinkSync(outbound, link)
  assert.throws(() => resolveOutboundFile(link), /must not be a symlink/)

  const registry = new OriginRegistry(join(dir, 'origins.json'))
  const origin = registry.create('owner-id')
  assert.deepEqual(registry.resolve(`[微信消息 bridge-origin=${origin}] 来自 owner\nhello`), { origin, userId: 'owner-id' })
  registry.consume(origin)
  assert.equal(registry.resolve(`[微信消息 bridge-origin=${origin}]`), undefined)
})
