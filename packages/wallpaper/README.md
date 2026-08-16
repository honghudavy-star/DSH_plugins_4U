# 更换背景壁纸（@dsh-plugins/wallpaper）

DSH 原生 Host 插件，通过 `webServer.tapIndex` 在页面 `<head>` 注入背景 CSS，不改写
DSH 客户端 bundle。

## 安装与使用

```bash
./install.sh wallpaper
```

安装后进入“设置 → 插件 → 自定义插件”，展开“壁纸”即可通过文件选择器选择本地图片、
选择内置预设、填写本地图片绝对路径、调整透明度或停用壁纸，不需要命令行配置。

内置预设为 `midnight`、`aurora`、`forest`、`sunset`。配置由 DSH settings 服务持久化。

修改后刷新 DSH 页面即可。Host 插件按每次 index 请求读取当前设置，因此无需重启或重装。
