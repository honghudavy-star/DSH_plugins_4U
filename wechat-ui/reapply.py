#!/usr/bin/env python3
# reapply.py — 把「微信入口」补丁重新应用到 dsh-client-ui-workspace 客户端 bundle。
#
# 用法:
#   python3 reapply.py                       # 自动定位 bundle（~/.npm/_npx/*/...）
#   python3 reapply.py <path/to/client.js>   # 指定 bundle 路径
#
# 幂等：已打过补丁时直接退出。改动后由 DSH 内置 client-hmr（500ms 轮询）自动热更新，
# 无需重启 DSH、无需刷新页面（浏览器没反应就刷新一次）。
#
# 组件代码的权威来源是同目录下的 dsh-client-ui-workspace.client.js.patched，
# 本脚本从其中提取补丁块再拼接，脚本本身无需随组件改动而更新。
import glob
import os
import sys

MARKER = "const WECHAT_SESSION_IDS"
PATCHED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dsh-client-ui-workspace.client.js.patched")

def locate_bundle():
    cands = sorted(
        glob.glob(os.path.expanduser("~/.npm/_npx/*/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js")),
        key=os.path.getmtime,
    )
    return cands[-1] if cands else None

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else locate_bundle()
    if not target:
        print("未找到 DSH workspace bundle，请手动指定路径: python3 reapply.py <client.js>")
        sys.exit(2)
    if not os.path.exists(target):
        print("文件不存在:", target)
        sys.exit(2)

    src = open(target, encoding="utf-8").read()
    if MARKER in src:
        print("already patched:", target)
        return

    patched = open(PATCHED, encoding="utf-8").read()
    start = patched.find("\t\t/**\n\t\t* dsh-wechat 本地补丁：")
    end = patched.find("\n\t\tfunction WorkspaceBrowser({ wide, expandSidebar,")
    if start == -1 or end == -1 or start >= end:
        print("patched 文件缺少补丁块，请重新拷贝 patched bundle 后重试")
        sys.exit(1)
    block = patched[start:end]

    anchor_a = "\t\tfunction WorkspaceBrowser({ wide, expandSidebar,"
    assert src.count(anchor_a) == 1, "anchor A 不唯一（bundle 版本可能已变化）"
    src = src.replace(anchor_a, block + "\n" + anchor_a)

    old_b = 'children: wide && (normalizedQuery !== "" ? (0, react_jsx_runtime.jsx)(SearchResults, {'
    assert src.count(old_b) == 1, "anchor B 不唯一（bundle 版本可能已变化）"
    src = src.replace(old_b, 'children: [wide && (normalizedQuery !== "" ? (0, react_jsx_runtime.jsx)(SearchResults, {')

    lit = 'setDeleteError(null);\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}))\n\t\t\t\t\t}),'
    assert src.count(lit) == 1, "anchor C 不唯一（bundle 版本可能已变化）"
    repl = ('setDeleteError(null);\n'
            '\t\t\t\t\t\t\t}\n'
            '\t\t\t\t\t\t})), (0, react_jsx_runtime.jsx)(WechatFolderSection, {\n'
            '\t\t\t\t\t\t\tuseSessions,\n'
            '\t\t\t\t\t\t\topen,\n'
            '\t\t\t\t\t\t\twide\n'
            '\t\t\t\t\t\t})]\n'
            '\t\t\t\t\t}),')
    src = src.replace(lit, repl)

    open(target, "w", encoding="utf-8").write(src)
    print("patched:", target)
    print("说明：HMR 会自动热更新；若浏览器未生效，刷新页面即可。")

if __name__ == "__main__":
    main()
