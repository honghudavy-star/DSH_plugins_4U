# 微信（@dsh-plugins/wechat）

DSH 原生组合插件：Host 侧托管微信桥接子进程，Web 侧通过
`sidebar.footer.action` 注册绿色快捷入口。

## 安装

```bash
./install.sh wechat
```

重启 DSH Web。首次启动时二维码会直接显示在 DSH 的终端中，用手机微信扫码即可。
插件创建或复用标题为“微信”的会话；DSH 回复会自动转回微信。

## 配置

可在 DSH 插件配置中设置：

- `enabled`：是否启动桥接器。
- `dshBase`：留空时使用当前 DSH Web 监听端口。
- `stateDir`：默认 `~/.dsh-wechat`。
- `owner` / `sessionId`：可选固定微信用户或 DSH 会话。
- `bridgePort`：本地主动发送接口，默认 `8790`。
- `bridgeToken`：可选显式 token，至少 32 个安全字符；留空会自动生成。
- `analyzeInboundImages`：默认调用 `@dsh-plugins/vision` 将微信图片转成文字。

主动发送示例：

```bash
curl -s -X POST http://127.0.0.1:8790/send \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(cat ~/.dsh-wechat/bridge-token)" \
  -d '{"text":"通知内容"}'
```

运行数据、登录凭据、Bearer token、断线转发水位和媒体文件位于 `~/.dsh-wechat/`，
目录/凭据文件分别强制为 `0700`/`0600`。只接受 owner 的入站消息，外发文件必须是绝对路径普通文件。
停用或卸载 Host
插件时，Cordis effect 会向桥接子进程发送 `SIGTERM`；异常退出会按配置延迟自动重启。
