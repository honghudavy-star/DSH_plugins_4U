# DSH 插件格式与 Cordis 准入规则

本文依据仓库开发时所用的 `@deepseek-ai/dsh@0.1.0-rc.6` 源码与官方开发文档整理。

## 1. Host 插件必须是 Cordis 插件

插件入口是一个可被 Node.js 导入的模块，至少导出 `apply(ctx, config)`。常用的可选导出包括：

- `name`：插件名，便于日志和诊断识别。
- `inject`：Cordis 服务依赖。所需服务未准备好时，Cordis 不会提前执行插件。
- `Config`：Schemastery 配置模型，供 DSH 验证配置和生成配置界面。

```js
export const name = 'example'
export const inject = ['webServer']
export function apply(ctx, config) {
  // 注册路由、事件或服务
}
```

`package.json` 还应通过 `main`/`exports["."]` 暴露该入口。

## 2. 可安装 bundle 必须声明补丁

DSH 的插件命令识别的是“带 bundle 元数据的 npm 包”：

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

`cordis.patch.yml` 是补丁数组。最小补丁向 Cordis Loader 插入一行：

```yaml
- insert:
    - id: example
      name: '@scope/example'
```

- `id` 是 profile 内稳定且唯一的 Loader 行标识。
- `name` 是安装到 profile 后可由 Node 解析的包名；开发时也可在手写 patch 中使用绝对路径。
- 没有 `dsh.bundle` 的包只能成为普通 npm 依赖，不会自动产生启用的 Cordis 层。
- 配置覆盖是整对象替换，不是深合并；后加载的 patch 优先。

官方安装入口会同时维护 profile 的依赖与 bundle 顺序：

```bash
dsh plugin --profile web add ./example-1.0.0.tgz
```

## 3. Web 插件必须提供 DSH 客户端 bundle

需要 UI 的包还要声明：

```json
{
  "exports": { "./client": "./client.js" },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings-plugins"
      ]
    }
  }
}
```

`client.js` 不是任意浏览器脚本。它必须向 DSH 的模块加载器注册与包名一致的模块：

```js
window.__ModuleLoader__.load({
  id: '@scope/example',
  factory: (require) => {
    const exports = {}
    exports.inject = ['slots']
    exports.apply = (ctx) => { /* 注册 UI */ }
    return exports
  },
})
```

DSH 会从已经启用的 Host Loader 行反查 npm manifest，再读取 `dsh.client` 和
`exports["./client"]`。因此只有客户端文件、但没有已启用 Host 行的包不会被发现；文件缺失或格式错误会使 Web 启动明确失败。

`dsh.client.inject` 描述客户端包之间的装载边；客户端真正何时执行，仍由导出的 Cordis
`inject` 服务依赖决定。

## 4. 设置页使用官方 Slot

DSH 的插件设置页面声明了列表槽 `settings.plugins.tab`。总插件用以下方式增加
“自定义插件”标签，而不修改 DSH 自身源码：

```js
ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
  name: 'settings.plugins.tab',
  id: 'dsh-plugins-4u',
  order: 50,
  label: '自定义插件',
}, CustomPluginsPage))
```

## 5. Cordis 接受插件的完整检查链

1. npm 包已安装到目标 DSH profile，且 Node 能解析包名和入口。
2. manifest 存在合法的 `dsh.bundle.patch`，补丁文件已随 tarball 发布。
3. 补丁产生唯一、启用状态正常的 Loader 行，行的 `name` 指向该包。
4. Host 模块可以导入，并导出函数 `apply`；`inject` 所需服务最终可用。
5. 若有 Web UI，manifest 同时暴露 `./client`、声明 `dsh.client.platform=web`，客户端调用
   `window.__ModuleLoader__.load`，其 `id` 与 npm 包名一致。
6. 插件只通过公开的 Cordis 服务、DSH route 或 Slot 扩展，不覆盖 DSH build 产物或缓存。
7. `npm pack` 后检查 tarball 内容，并在隔离的 `DSH_HOME` 中执行安装、配置 dump 和启动验证。

本仓库根包 `@dsh-plugins/4u` 满足同一套规则。它的 Host 入口没有副作用，仅用于让 DSH
发现根包客户端；客户端注册“自定义插件”设置页。微信、壁纸和识图仍各有独立的 Host
Loader 行，可以分别配置、停用和升级。
