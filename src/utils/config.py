"""配置与环境变量加载工具。"""

from __future__ import annotations

import os
import re
import warnings
from pathlib import Path
from typing import Any, Dict, Optional, Union

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None  # type: ignore


def load_config(config_path: Optional[Union[Path, str]] = None) -> Dict[str, Any]:
    """读取 YAML 配置文件。

    若已安装 PyYAML，则使用标准 YAML 解析；否则使用内置的简单解析器
    处理本项目用到的基本键值（字符串、列表、单层字典）。
    读取前会先加载同目录 .env 文件（若 python-dotenv 已安装）。
    """
    if load_dotenv is not None:
        load_dotenv()

    if config_path is None:
        config_path = Path("config.yaml")
    else:
        config_path = Path(config_path)

    if not config_path.exists():
        warnings.warn(f"配置文件不存在: {config_path}", RuntimeWarning)
        return {}

    try:
        import yaml

        with config_path.open("r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        warnings.warn("PyYAML 未安装，使用内置简单 YAML 解析器", RuntimeWarning)
    except Exception as exc:
        warnings.warn(f"YAML 解析失败: {exc}", RuntimeWarning)
        return {}

    return _parse_simple_yaml(config_path)


def _parse_simple_yaml(path: Path) -> Dict[str, Any]:
    """极简 YAML 解析，支持顶层 key: value / list / dict，以及 dict 内含 list。"""
    result: Dict[str, Any] = {}
    current_key: Optional[str] = None
    current_list: Optional[list] = None
    current_dict: Optional[Dict[str, Any]] = None
    current_dict_key: Optional[str] = None
    current_nested_list: Optional[list] = None

    def _coerce_scalar(value: str) -> Union[str, bool, int]:
        if value.startswith('"') and value.endswith('"'):
            return value[1:-1]
        if value in ("true", "True"):
            return True
        if value in ("false", "False"):
            return False
        if re.fullmatch(r"-?\d+", value):
            return int(value)
        return value

    with path.open("r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.split("#", 1)[0].rstrip("\n\r")
            if not line.strip():
                continue

            stripped = line.lstrip()
            indent = len(line) - len(stripped)

            if indent == 0:
                current_key = None
                current_list = None
                current_dict = None
                current_dict_key = None
                current_nested_list = None
                if ":" not in stripped:
                    continue
                key, _, value = stripped.partition(":")
                key = key.strip()
                value = value.strip()
                if value == "":
                    result[key] = None
                    current_key = key
                else:
                    result[key] = _coerce_scalar(value)
                continue

            if current_key is None:
                continue

            if indent == 2:
                current_list = None
                current_nested_list = None
                if stripped.startswith("-"):
                    item = stripped[1:].strip()
                    if current_list is None:
                        current_list = []
                        result[current_key] = current_list
                    current_list.append(_coerce_scalar(item))
                elif ":" in stripped:
                    sub_key, _, sub_value = stripped.partition(":")
                    sub_key = sub_key.strip()
                    sub_value = sub_value.strip()
                    if current_dict is None:
                        current_dict = {}
                        result[current_key] = current_dict
                    if sub_value == "":
                        current_dict_key = sub_key
                        current_dict[sub_key] = None
                    else:
                        current_dict[sub_key] = _coerce_scalar(sub_value)
                continue

            if indent >= 4:
                if stripped.startswith("-"):
                    item = stripped[1:].strip()
                    if current_dict is not None and current_dict_key is not None:
                        if current_nested_list is None:
                            current_nested_list = []
                            current_dict[current_dict_key] = current_nested_list
                        current_nested_list.append(_coerce_scalar(item))
                    else:
                        if current_list is None:
                            current_list = []
                            result[current_key] = current_list
                        current_list.append(_coerce_scalar(item))
                continue

    return result


def load_env(path: Optional[Union[Path, str]] = Path(".env")) -> Dict[str, str]:
    """读取 .env 文件为键值对字典。

    忽略空行与以 # 开头的注释行；值两端的引号会被去除。
    """
    if path is None:
        path = Path(".env")
    else:
        path = Path(path)

    env: Dict[str, str] = {}
    if not path.exists():
        return env

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if (value.startswith('"') and value.endswith('"')) or (
                value.startswith("'") and value.endswith("'")
            ):
                value = value[1:-1]
            env[key] = value

    return env


def get_llm_config() -> Dict[str, str]:
    """从环境变量与 config.yaml 读取 LLM 配置。

    优先级：环境变量 > config.yaml > 默认值。
    """
    config = load_config(Path("/workspace/config.yaml")) if Path("/workspace/config.yaml").exists() else {}
    config_model = config.get("model") if isinstance(config, dict) else None
    return {
        "api_key": os.getenv("LLM_API_KEY", ""),
        "base_url": os.getenv("LLM_BASE_URL", ""),
        "model": os.getenv("LLM_MODEL") or config_model or "qwen-plus",
    }
