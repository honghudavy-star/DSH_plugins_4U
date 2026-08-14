# 更换背景壁纸（@dsh-plugins/wallpaper）

> 一条命令给 DSH 换壁纸，装完立刻能看到效果。

## 这是什么？

给 DSH 界面加一张背景壁纸（半透明浮层，不影响按钮/文字/操作）。

- 🖼️ **内置 4 张预设壁纸**：`midnight`（深夜蓝）/ `aurora`（极光）/ `forest`（深林绿）/ `sunset`（暮色）
- 🗂️ **也可以用自己的图片**：`dsh-plugins-wallpaper set /path/to/图.jpg`
- 🎚️ 可调透明度（默认 0.3，值越大壁纸越明显）
- ⏻ 一键关闭：`dsh-plugins-wallpaper off`
- ⚡ 换完**即时生效**（HMR 热更新），不用重启、不用刷新

## 怎么用

```bash
npm pack ./packages/wallpaper && npm install --global --foreground-scripts dsh-plugins-wallpaper-*.tgz
# 装完默认应用「midnight」壁纸

dsh-plugins-wallpaper list                        # 看内置预设
dsh-plugins-wallpaper set aurora                  # 换预设
dsh-plugins-wallpaper set ~/Pictures/星空.jpg      # 用自己的图
dsh-plugins-wallpaper set forest --opacity 0.5    # 调透明度
dsh-plugins-wallpaper off                         # 关闭
dsh-plugins-wallpaper status                      # 当前状态
```

## 原理（给维护者）

壁纸图压缩成 JPEG（macOS 用 `sips`）→ base64 内嵌 → 注入 DSH 主题客户端 bundle
（`dsh-client-ui-theme/lib/client.js`）里的一段 CSS：
`body::before` 全屏背景浮层（`pointer-events:none`、可调 opacity），由 DSH 内置 HMR 自动热更新。
`off` 即把该段代码移除。DSH 升级还原后，重跑安装（或 `dsh-plugins-wallpaper apply`）即可恢复。

若 `~/.npm/_npx` 中同时存在多个完整 DSH 主题缓存，脚本不会用文件时间猜测
当前运行目标；请设置 `DSH_NPX_RUNTIME_DIR` 为实际启动 DSH 的 npm-exec 运行时目录后重试。
壁纸 bundle 与配置更新会先完整暂存，任一提交失败都会回滚已经替换的文件。
