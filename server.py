# -*- coding: utf-8 -*-
"""DreamTale · 纯静态文件服务器（阶段1：无 AI、无数据库、断网可运行）

启动：`python server.py`，监听 7860 端口（ModelScope 兼容）。
托管 `web/` 目录下的静态站点，支持 SPA 路由回退与 CORS。

阶段5 桥接服务请运行 `python scripts/dreamtale/bridge-server.py`，监听 7861 端口。
桥接服务提供 Python 脚本调用（check_consistency / check_ai_novel / audit_hooks）
+ SSE 文件变更推送（watchdog 监听 NovelForge_Vault/）。
本 server.py 仅负责静态托管，桥接逻辑独立运行，避免单进程阻塞。

Core 层（web/src/core/）始终保持零 AI 依赖。
"""

from __future__ import annotations

import http.server
import socketserver
import os
from pathlib import Path

PORT = int(os.environ.get("PORT", 7860))
WEB_DIR = Path(__file__).resolve().parent / "web"


class StaticHandler(http.server.SimpleHTTPRequestHandler):
    """静态文件 + SPA 回退 + CORS 头。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self):
        # SPA 回退：非文件请求一律返回 index.html
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path == "/" or path == "":
            self.path = "/index.html"
        else:
            candidate = WEB_DIR / path.lstrip("/")
            if not candidate.is_file():
                # 隐藏文件 / 含 .. 的请求不回退，直接 404
                if not path.startswith("/.") and ".." not in path:
                    self.path = "/index.html"
        return super().do_GET()

    def end_headers(self):
        # CORS：本地开发友好（file:// 双击打开不需要 CORS，但 localhost 调试需要）
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        # 简化日志，避免 CI 噪音
        pass


def main():
    if not WEB_DIR.exists():
        print(f"⚠️  web/ 目录不存在：{WEB_DIR}")
        print("   请先创建 web/index.html")
        return
    os.chdir(str(WEB_DIR))
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), StaticHandler) as httpd:
        print(f"📖 DreamTale 静态服务启动：http://localhost:{PORT}")
        print(f"   托管目录：{WEB_DIR}")
        print(f"   双击打开：{WEB_DIR / 'index.html'}")
        print("   Ctrl+C 退出")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 已退出")


if __name__ == "__main__":
    main()
