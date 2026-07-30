#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DreamTale · 本地桥接服务（阶段5）

职责：
- HTTP 服务（基于标准库 http.server，不引 FastAPI，保持轻量）
- 桥接前端 JS 与 NovelForge Python 脚本：
    * POST /api/check/consistency       → check_consistency.py
    * POST /api/check/ai-novel          → check_ai_novel.py
    * POST /api/audit/hooks             → audit_hooks.py
    * POST /api/skill/architect         → 占位（阶段5 后续 Trae Skill 触发）
    * POST /api/skill/writer-polisher   → 占位
- SSE 推送 NovelForge_Vault/ 目录文件变更事件：
    * GET /api/events                   → text/event-stream
    * watchdog 优先，未安装则降级为定时轮询
- 健康检查：GET /api/health

端口：7861（与静态服务 7860 区分）
CORS：允许 localhost:7860

启动：
    python scripts/dreamtale/bridge-server.py
    # 自定义端口 / Vault 路径：
    BRIDGE_PORT=7861 BRIDGE_VAULT=/workspace/NovelForge_Vault python scripts/dreamtale/bridge-server.py
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

# ============================================================================
# 常量
# ============================================================================
DEFAULT_PORT = int(os.environ.get("BRIDGE_PORT", "7861"))
DEFAULT_VAULT = os.environ.get(
    "BRIDGE_VAULT", "/workspace/NovelForge_Vault"
)
DEFAULT_TIMEOUT = 120  # subprocess 超时（秒）
CORS_ORIGIN = "http://localhost:7860"

# NovelForge 脚本根目录（用于构造 subprocess 调用）
WORKSPACE_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = WORKSPACE_ROOT / "scripts" / "novelforge"

# watchdog 可选依赖：未安装时降级为轮询
try:
    from watchdog.observers import Observer as _WatchdogObserver  # type: ignore
    from watchdog.events import FileSystemEventHandler as _WatchdogFSEH  # type: ignore
    HAS_WATCHDOG = True
except ImportError:
    _WatchdogObserver = None  # type: ignore
    _WatchdogFSEH = object  # type: ignore  # 占位基类，让 _WatchdogHandler 类定义永远成功
    HAS_WATCHDOG = False

# ============================================================================
# SSE 客户端管理
# ============================================================================
class SSEBroker:
    """SSE 客户端连接池 + 事件广播。

    所有 GET /api/events 连接会注册一个 deque，由 watchdog/轮询线程
    通过 broadcast() 推送事件。每个连接独立消费，互不阻塞。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._clients: list[Any] = []  # 每个 client 是一个 deque[(event_type, payload)]

    def register(self, client: Any) -> None:
        with self._lock:
            if client not in self._clients:
                self._clients.append(client)

    def unregister(self, client: Any) -> None:
        with self._lock:
            if client in self._clients:
                self._clients.remove(client)

    def broadcast(self, event_type: str, payload: dict) -> int:
        """广播事件，返回成功推送的客户端数量。"""
        delivered = 0
        with self._lock:
            clients = list(self._clients)
        for client in clients:
            try:
                client.append((event_type, payload))
                delivered += 1
            except Exception:
                # 客户端 deque 异常时移除
                self.unregister(client)
        return delivered

    def client_count(self) -> int:
        with self._lock:
            return len(self._clients)


BROKER = SSEBroker()


# ============================================================================
# 文件监听：watchdog 优先，降级轮询
# ============================================================================
class VaultWatcher:
    """监听 Vault 目录变更，事件转发到 SSEBroker。

    优先使用 watchdog（事件驱动）；未安装时降级为 2 秒间隔的轮询。
    """

    def __init__(self, vault_path: str, broker: SSEBroker) -> None:
        self.vault_path = Path(vault_path).resolve()
        self.broker = broker
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._watchdog_observer = None
        self._snapshot: dict[str, float] = {}

    def start(self) -> None:
        if not self.vault_path.exists():
            print(
                f"[watcher] ⚠️  Vault 目录不存在：{self.vault_path}（监听将启动但暂无事件）",
                file=sys.stderr,
            )
        # 优先使用 watchdog（模块顶部已探测可用性）
        if HAS_WATCHDOG:
            try:
                handler = _WatchdogHandler(self.broker, self.vault_path)
                observer = _WatchdogObserver()
                observer.schedule(handler, str(self.vault_path), recursive=True)
                observer.start()
                self._watchdog_observer = observer
                print(f"[watcher] watchdog 监听已启动：{self.vault_path}")
                return
            except Exception as e:  # noqa: BLE001
                print(f"[watcher] watchdog 启动失败，降级轮询：{e}", file=sys.stderr)
                self._watchdog_observer = None
        else:
            print("[watcher] watchdog 未安装，降级为轮询模式（2s 间隔）")

        # 降级轮询
        self._snapshot = self._scan()
        self._thread = threading.Thread(
            target=self._poll_loop, daemon=True, name="vault-poll"
        )
        self._thread.start()
        print(f"[watcher] 轮询监听已启动：{self.vault_path}")

    def stop(self) -> None:
        self._stop.set()
        if self._watchdog_observer is not None:
            try:
                self._watchdog_observer.stop()
                self._watchdog_observer.join(timeout=2)
            except Exception:  # noqa: BLE001
                pass
            self._watchdog_observer = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def _scan(self) -> dict[str, float]:
        snapshot: dict[str, float] = {}
        if not self.vault_path.exists():
            return snapshot
        try:
            for root, _dirs, files in os.walk(self.vault_path):
                # 跳过 .git / .state 等高频变更目录以减少噪音
                parts = Path(root).relative_to(self.vault_path).parts
                if any(p in {".git"} for p in parts):
                    continue
                for name in files:
                    fp = Path(root) / name
                    try:
                        snapshot[str(fp.relative_to(self.vault_path))] = fp.stat().st_mtime
                    except OSError:
                        continue
        except Exception:  # noqa: BLE001
            pass
        return snapshot

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            time.sleep(2)
            new_snapshot = self._scan()
            self._diff_and_emit(self._snapshot, new_snapshot)
            self._snapshot = new_snapshot

    def _diff_and_emit(
        self, old: dict[str, float], new: dict[str, float]
    ) -> None:
        old_keys = set(old.keys())
        new_keys = set(new.keys())
        # 新增
        for k in new_keys - old_keys:
            self.broker.broadcast(
                "vault:change",
                {"type": "created", "path": k, "mtime": new[k]},
            )
        # 删除
        for k in old_keys - new_keys:
            self.broker.broadcast(
                "vault:change",
                {"type": "deleted", "path": k, "mtime": old[k]},
            )
        # 修改
        for k in old_keys & new_keys:
            if old[k] != new[k]:
                self.broker.broadcast(
                    "vault:change",
                    {"type": "modified", "path": k, "mtime": new[k]},
                )


class _WatchdogHandler(_WatchdogFSEH):  # type: ignore
    """watchdog 事件适配器：把文件系统事件转成 SSE 事件。

    基类 _WatchdogFSEH 在 watchdog 已安装时为
    ``watchdog.events.FileSystemEventHandler``，未安装时为 ``object`` 占位
    （此情况下本类不会被实例化，仅保留定义以便模块加载）。
    """

    def __init__(self, broker: SSEBroker, vault_root: Path) -> None:
        super().__init__()
        self.broker = broker
        self.vault_root = vault_root

    def _emit(self, event_type: str, src_path: str) -> None:
        try:
            rel = str(Path(src_path).relative_to(self.vault_root))
        except ValueError:
            rel = src_path
        # 跳过 .git 目录
        if rel.startswith(".git") or "/.git/" in rel:
            return
        try:
            mtime = os.path.getmtime(src_path)
        except OSError:
            mtime = time.time()
        self.broker.broadcast(
            "vault:change",
            {"type": event_type, "path": rel, "mtime": mtime},
        )

    def on_created(self, event):  # noqa: D401
        if not event.is_directory:
            self._emit("created", event.src_path)

    def on_modified(self, event):  # noqa: D401
        if not event.is_directory:
            self._emit("modified", event.src_path)

    def on_deleted(self, event):  # noqa: D401
        if not event.is_directory:
            self._emit("deleted", event.src_path)

    def on_moved(self, event):  # noqa: D401
        if not event.is_directory:
            self._emit("deleted", event.src_path)
            self._emit("created", event.dest_path)


# ============================================================================
# subprocess 桥接
# ============================================================================
def run_python_script(
    script_name: str,
    vault: str,
    extra_args: Optional[list[str]] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> dict:
    """运行 scripts/novelforge/<script_name>.py，返回结构化结果。

    返回：
        {
          "ok": bool,         # 是否执行成功（exit 0）
          "exit_code": int,
          "stdout": str,
          "stderr": str,
          "report": Any|None, # 若 stdout 是合法 JSON，则解析后的对象
          "duration_ms": int,
        }
    """
    script_path = SCRIPTS_DIR / f"{script_name}.py"
    if not script_path.exists():
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"脚本不存在：{script_path}",
            "report": None,
            "duration_ms": 0,
        }
    cmd = [sys.executable, str(script_path), "--vault", vault]
    if extra_args:
        cmd.extend(extra_args)

    start = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(WORKSPACE_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
        report: Any = None
        # 尝试解析 JSON（多行 stdout 时取最后一行非空内容做 JSON 探测）
        try:
            stripped = stdout.strip()
            if stripped:
                # 直接整段解析
                if stripped.startswith("{") or stripped.startswith("["):
                    report = json.loads(stripped)
                else:
                    # 尝试最后一行
                    last_line = stripped.splitlines()[-1].strip()
                    if last_line.startswith("{") or last_line.startswith("["):
                        report = json.loads(last_line)
        except (json.JSONDecodeError, ValueError):
            report = None
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "report": report,
            "duration_ms": int((time.time() - start) * 1000),
        }
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"脚本执行超时（{timeout}s）：{script_name}",
            "report": None,
            "duration_ms": int((time.time() - start) * 1000),
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"脚本执行异常：{e}",
            "report": None,
            "duration_ms": int((time.time() - start) * 1000),
        }


# ============================================================================
# HTTP Handler
# ============================================================================
class BridgeHandler(BaseHTTPRequestHandler):
    """桥接 HTTP 处理器。"""

    server_version = "DreamTaleBridge/0.1"

    # ---------- 通用工具 ----------
    def _set_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._set_cors()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _read_json_body(self) -> Optional[dict]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        try:
            raw = self.rfile.read(length).decode("utf-8")
            if not raw.strip():
                return {}
            return json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            self._send_json(400, {"ok": False, "error": f"请求体 JSON 解析失败：{e}"})
            return None

    def _vault_from_body(self, body: Optional[dict]) -> str:
        if body and isinstance(body.get("vault"), str) and body["vault"]:
            return body["vault"]
        return DEFAULT_VAULT

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    # ---------- GET ----------
    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "service": "dreamtale-bridge",
                    "version": "0.1.0",
                    "vault": DEFAULT_VAULT,
                    "clients": BROKER.client_count(),
                    "watchdog": _get_watcher_status(),
                },
            )
            return
        if path == "/api/events":
            self._handle_sse()
            return
        self._send_json(404, {"ok": False, "error": f"未知路径：{path}"})

    # ---------- POST ----------
    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        body = self._read_json_body()
        if body is None:
            return  # 错误已发送
        if path == "/api/check/consistency":
            self._handle_check("check_consistency", body)
            return
        if path == "/api/check/ai-novel":
            self._handle_check("check_ai_novel", body)
            return
        if path == "/api/audit/hooks":
            self._handle_audit_hooks(body)
            return
        if path == "/api/skill/architect":
            self._handle_skill_placeholder("architect", body)
            return
        if path == "/api/skill/writer-polisher":
            self._handle_skill_placeholder("writer-polisher", body)
            return
        self._send_json(404, {"ok": False, "error": f"未知路径：{path}"})

    # ---------- 业务处理 ----------
    def _handle_check(self, script: str, body: dict) -> None:
        vault = self._vault_from_body(body)
        extra: list[str] = []
        # 支持可选 chapter / strict / json 参数透传
        if "chapter" in body and body["chapter"] is not None:
            extra.extend(["--chapter", str(body["chapter"])])
        if body.get("strict"):
            extra.append("--strict")
        # 默认强制 JSON 输出，便于前端解析
        if "--json" not in extra:
            extra.append("--json")
        result = run_python_script(script, vault, extra_args=extra)
        self._send_json(200 if result["ok"] else 200, result)

    def _handle_audit_hooks(self, body: dict) -> None:
        vault = self._vault_from_body(body)
        # audit_hooks.py 必须有 --current-ch 才能输出审计报告；缺省用 1
        current_ch = body.get("current_ch") or body.get("chapter") or 1
        extra = ["--current-ch", str(current_ch), "--json"]
        result = run_python_script("audit_hooks", vault, extra_args=extra)
        self._send_json(200, result)

    def _handle_skill_placeholder(self, name: str, body: dict) -> None:
        """Trae Skill 触发占位端点：阶段5 后续接入真实 Skill 调用。"""
        self._send_json(
            200,
            {
                "ok": True,
                "placeholder": True,
                "skill": name,
                "message": (
                    f"Skill `{name}` 触发端点占位：阶段5 后续接入 Trae Skill。"
                    " 当前请通过 Trae IDE 界面手动调用对应 Skill。"
                ),
                "echo": body,
            },
        )

    # ---------- SSE ----------
    def _handle_sse(self) -> None:
        from collections import deque

        client: Any = deque(maxlen=64)
        BROKER.register(client)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self._set_cors()
            self.end_headers()
            # 先发一个 hello 事件，让前端立即收到连接确认
            self._sse_write({"event": "hello", "data": {"ts": time.time()}})
            while True:
                if client:
                    event_type, payload = client.popleft()
                    self._sse_write(
                        {"event": event_type, "data": payload}
                    )
                else:
                    # 心跳：每 15s 一次
                    self._sse_write({"event": "ping", "data": {"ts": time.time()}})
                    # 阻塞等待新事件，最多 15s
                    waited = 0.0
                    while not client and waited < 15.0:
                        time.sleep(0.5)
                        waited += 0.5
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            BROKER.unregister(client)

    def _sse_write(self, msg: dict) -> None:
        event = msg.get("event", "message")
        data = msg.get("data", {})
        payload = json.dumps(data, ensure_ascii=False)
        chunk = f"event: {event}\ndata: {payload}\n\n"
        try:
            self.wfile.write(chunk.encode("utf-8"))
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            raise

    def log_message(self, format, *args):  # noqa: A002
        # 简化日志，避免 SSE 长连接刷屏
        path = self.path.split("?", 1)[0]
        if path == "/api/events":
            return
        sys.stderr.write(
            "[bridge] %s - %s\n" % (self.address_string(), format % args)
        )


# ============================================================================
# Watcher 状态查询
# ============================================================================
_WATCHER: Optional[VaultWatcher] = None


def _get_watcher_status() -> str:
    global _WATCHER
    if _WATCHER is None:
        return "stopped"
    if _WATCHER._watchdog_observer is not None:
        return "watchdog"
    if _WATCHER._thread is not None and _WATCHER._thread.is_alive():
        return "polling"
    return "stopped"


# ============================================================================
# 入口
# ============================================================================
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="DreamTale 本地桥接服务（阶段5）"
    )
    parser.add_argument(
        "--port", type=int, default=DEFAULT_PORT,
        help=f"监听端口（默认 {DEFAULT_PORT}，env BRIDGE_PORT）"
    )
    parser.add_argument(
        "--vault", default=DEFAULT_VAULT,
        help=f"NovelForge Vault 路径（默认 {DEFAULT_VAULT}，env BRIDGE_VAULT）"
    )
    parser.add_argument(
        "--host", default="127.0.0.1",
        help="监听地址（默认 127.0.0.1，仅本机访问）"
    )
    return parser.parse_args()


def main() -> int:
    global DEFAULT_VAULT, DEFAULT_PORT, _WATCHER
    args = parse_args()
    DEFAULT_VAULT = args.vault
    DEFAULT_PORT = args.port

    # 启动 Vault 文件监听
    _WATCHER = VaultWatcher(DEFAULT_VAULT, BROKER)
    _WATCHER.start()

    server = ThreadingHTTPServer((args.host, DEFAULT_PORT), BridgeHandler)
    print(f"🌉 DreamTale 桥接服务启动：http://{args.host}:{DEFAULT_PORT}")
    print(f"   Vault：{DEFAULT_VAULT}")
    print(f"   CORS：{CORS_ORIGIN}")
    print(f"   端点：")
    print(f"     GET  /api/health")
    print(f"     GET  /api/events            (SSE)")
    print(f"     POST /api/check/consistency")
    print(f"     POST /api/check/ai-novel")
    print(f"     POST /api/audit/hooks")
    print(f"     POST /api/skill/architect   (placeholder)")
    print(f"     POST /api/skill/writer-polisher (placeholder)")
    print(f"   Ctrl+C 退出")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 已退出")
    finally:
        _WATCHER.stop()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
