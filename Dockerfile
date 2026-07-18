# syntax=docker/dockerfile:1.7
# DreamTale · 小说创作后台首页 — Docker 镜像
#
# 当前阶段：单文件 Gradio 应用 (app.py)
# 未来扩展：可在此 Dockerfile 基础上添加 FastAPI 后端、数据库、向量检索等
#
# 关键约定：
# - ModelScope Studio Docker SDK 要求服务监听 7860 端口
# - /mnt/workspace 是 ModelScope 唯一持久化目录（数据库/缓存/上传文件放这里）
# - 非 root 用户运行（UID/GID 1001，与 ModelScope volume 权限对齐）
#
# 镜像结构参考 ReUp 项目的多阶段构建思路，但当前阶段应用简单，
# 暂时使用单阶段构建。后续扩展为多服务时再拆分 deps/builder/runner。

ARG PYTHON_VERSION=3.11
ARG APP_UID=1001
ARG APP_GID=1001

FROM python:${PYTHON_VERSION}-slim AS runner

ARG APP_UID
ARG APP_GID

# OCI 标准镜像元数据
LABEL org.opencontainers.image.title="DreamTale"
LABEL org.opencontainers.image.description="DreamTale · 小说创作后台首页 (Gradio)"
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

# 复制应用代码
COPY app.py ./

# 运行时目录：ModelScope 唯一持久化目录 /mnt/workspace
# 未来扩展：数据库、上传文件、缓存都放这里
RUN mkdir -p /mnt/workspace/data /mnt/workspace/.cache \
    && chown -R dreamtale:dreamtale /app /mnt/workspace

USER dreamtale

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/mnt/workspace/.cache \
    TMPDIR=/mnt/workspace/.cache/tmp

# ModelScope Studio Docker SDK 要求端口 7860
EXPOSE 7860

# 健康检查：Gradio 默认根路径返回 200
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:7860/ || exit 1

# 启动 Gradio 应用
CMD ["python", "app.py"]
