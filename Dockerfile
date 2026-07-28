# syntax=docker/dockerfile:1.7
# DreamTale · 小说创作平台 — Docker 镜像
#
# 当前阶段：FastAPI + 静态前端 + SQLite（Phase 1 MVP，纯手工写作平台）
# 未来扩展：Phase 2 接入 AI 增强层；Phase 4 接入热点采集
#
# 关键约定（ModelScope Studio Docker SDK 兼容）：
# - 服务监听 7860 端口
# - /mnt/workspace 是 ModelScope 唯一持久化目录（数据库/缓存/上传文件放这里）
# - 非 root 用户运行（UID/GID 1001，与 ModelScope volume 权限对齐）
#
# 镜像结构：当前阶段应用简单，使用单阶段构建。后续扩展为多服务时再拆分 deps/builder/runner。

ARG PYTHON_VERSION=3.11
ARG APP_UID=1001
ARG APP_GID=1001

FROM python:${PYTHON_VERSION}-slim AS runner

ARG APP_UID
ARG APP_GID

# OCI 标准镜像元数据
LABEL org.opencontainers.image.title="DreamTale"
LABEL org.opencontainers.image.description="DreamTale · 小说创作平台 (FastAPI)"
LABEL org.opencontainers.image.source="https://github.com/codengseam/DreamTale"

WORKDIR /app

# 运行时系统依赖：curl 用于 HEALTHCHECK，fontconfig 用于中文字体回退
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# 非 root 用户运行（与 ModelScope volume 挂载宿主目录权限对齐）
RUN groupadd --system --gid ${APP_GID} dreamtale \
    && useradd --system --uid ${APP_UID} --gid dreamtale \
       --create-home --shell /bin/bash dreamtale

# 先复制依赖清单，利用 docker 层缓存
COPY requirements.txt ./

# 安装 Python 依赖（--no-cache-dir 减小镜像体积）
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# 复制应用代码：FastAPI 入口 + 业务脚本 + 静态前端
# 注：requirements.txt 已在上方复制用于 pip install，此处不重复
COPY server.py ./
COPY scripts/dreamtale/ ./scripts/dreamtale/
COPY static/ ./static/

# 运行时目录：ModelScope 唯一持久化目录 /mnt/workspace
# - data/：SQLite 数据库文件
# - .cache/：临时文件与缓存
RUN mkdir -p /mnt/workspace/data /mnt/workspace/.cache \
    && chown -R dreamtale:dreamtale /app /mnt/workspace

USER dreamtale

# 数据库路径默认指向持久化目录，避免容器重启丢数据
# 本地开发时可在 .env 中覆盖为 data/dreamtale.db
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DREAMTALE_DB=/mnt/workspace/data/dreamtale.db \
    TMPDIR=/mnt/workspace/.cache/tmp

# ModelScope Studio Docker SDK 要求端口 7860
EXPOSE 7860

# 健康检查：FastAPI 根路径返回 200
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:7860/ || exit 1

# 启动流程：
# 1) 初始化数据库（优先调用 seed.py --if-empty；若 Agent A 的 seed.py 未实现该参数则 fallback 到 db.init_db）
# 2) 启动 FastAPI 服务（uvicorn 由 server.py 内部拉起）
CMD ["sh", "-c", "python scripts/dreamtale/seed.py --if-empty || python -c 'from scripts.dreamtale.db import init_db; init_db()'; python server.py"]
