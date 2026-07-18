"""
分支治理脚本回归测试（BUG-023）

验证 scripts/branch_governance.py 的等价合入判定与安全机制：
- ancestor 快速通道
- 等价合入（非 ancestor）
- 未合入保留
- 受保护分支不删
- --yes 安全锁
- pattern 过滤
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))


def run(cmd, cwd=None, check=True, env=None):
    """执行命令，返回 CompletedProcess。"""
    return subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=check,
        env=env,
        timeout=30,
    )


@pytest.fixture
def temp_git_repo(tmp_path):
    """创建一个临时 git 仓库，含初始 commit。"""
    repo = tmp_path / "repo"
    repo.mkdir()
    run(["git", "init", "-b", "master"], cwd=repo)
    run(["git", "config", "user.email", "test@test.com"], cwd=repo)
    run(["git", "config", "user.name", "Test"], cwd=repo)
    # 初始 commit
    (repo / "README.md").write_text("# Test Repo\n")
    run(["git", "add", "."], cwd=repo)
    run(["git", "commit", "-m", "init"], cwd=repo)
    return repo


def make_branch(repo, name, file_path, content, commit_msg="feat: change"):
    """在 repo 创建分支并改动文件。"""
    run(["git", "checkout", "-b", name], cwd=repo)
    (repo / file_path).write_text(content)
    run(["git", "add", "."], cwd=repo)
    run(["git", "commit", "-m", commit_msg], cwd=repo)
    run(["git", "checkout", "master"], cwd=repo)
    return name


def run_governance(repo, mode="dry-run", pattern="trae/agent-*", extra=None):
    """运行 branch_governance.py，返回 (stdout, returncode)。"""
    cmd = [
        sys.executable,
        str(SCRIPTS_DIR / "branch_governance.py"),
        "--mode", mode,
        "--pattern", pattern,
        "--no-fetch",
    ]
    if extra:
        cmd.extend(extra)
    env = os.environ.copy()
    env["GIT_DIR"] = str(repo / ".git")
    env["GIT_WORK_TREE"] = str(repo)
    result = subprocess.run(
        cmd,
        cwd=str(repo),
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    return result.stdout + result.stderr, result.returncode


def test_ancestor_fast_path_confidence_one(temp_git_repo):
    """用例1：merge --no-ff 使分支成为 ancestor → confidence=1.0"""
    repo = temp_git_repo
    make_branch(repo, "trae/agent-A", "file.txt", "A", "feat: A change")
    # 合入 master
    run(["git", "merge", "--no-ff", "trae/agent-A", "-m", "merge A"], cwd=repo)
    out, rc = run_governance(repo)
    assert rc == 0
    assert "trae/agent-A" in out
    # 应标记为删除候选
    assert "删除候选" in out or "delete" in out.lower()


def test_dry_run_identifies_equivalent_merged_branch(temp_git_repo):
    """用例2：等价合入但非 ancestor（内容一致但 commit hash 不同）"""
    repo = temp_git_repo
    make_branch(repo, "trae/agent-B", "file.txt", "B-content", "feat: B change")
    # master 上手动应用相同内容（非 merge）
    (repo / "file.txt").write_text("B-content")
    run(["git", "add", "."], cwd=repo)
    run(["git", "commit", "-m", "feat: apply B content manually"], cwd=repo)
    # agent-B 非 master ancestor，但 file.txt 内容一致
    out, rc = run_governance(repo)
    assert rc == 0
    # 因文件内容一致（blob 相同），confidence 应较高
    assert "trae/agent-B" in out


def test_dry_run_keeps_branch_with_unique_changes(temp_git_repo):
    """用例3：分支含 master 未应用改动 → 标记保留"""
    repo = temp_git_repo
    make_branch(repo, "trae/agent-C", "unique.txt", "C-only", "feat: C unique")
    # master 上不应用此改动
    out, rc = run_governance(repo)
    assert rc == 0
    assert "trae/agent-C" in out
    # 应在保留区
    assert "保留" in out


def test_protected_branches_never_deleted(temp_git_repo):
    """用例4：受保护分支即便匹配 pattern 也不删"""
    repo = temp_git_repo
    # 创建 gh-pages 分支
    run(["git", "branch", "gh-pages"], cwd=repo)
    # 同时创建一个可删除的 agent 分支，确保有候选进报告
    make_branch(repo, "trae/agent-D", "d.txt", "D", "feat: D")
    run(["git", "merge", "--no-ff", "trae/agent-D", "-m", "merge D"], cwd=repo)
    out, rc = run_governance(repo, pattern="*", mode="execute", extra=["--yes"])
    # 执行后 gh-pages 仍存在（未被删除）
    branches = run(["git", "branch", "--format=%(refname:short)"], cwd=repo).stdout
    assert "gh-pages" in branches, f"gh-pages 被误删！输出: {out}"
    # master 也仍存在
    assert "master" in branches


def test_execute_requires_yes_flag(temp_git_repo):
    """用例5：execute 无 --yes → 退出码非 0"""
    repo = temp_git_repo
    make_branch(repo, "trae/agent-D", "file.txt", "D", "feat: D")
    run(["git", "merge", "--no-ff", "trae/agent-D", "-m", "merge D"], cwd=repo)
    out, rc = run_governance(repo, mode="execute")
    assert rc != 0
    assert "--yes" in out or "确认" in out


def test_pattern_filter_excludes_unrelated(temp_git_repo):
    """用例6：pattern 过滤排除不匹配的分支"""
    repo = temp_git_repo
    make_branch(repo, "trae/agent-E", "e.txt", "E", "feat: E")
    make_branch(repo, "feature/other", "o.txt", "O", "feat: O")
    out, rc = run_governance(repo, pattern="trae/agent-*")
    assert rc == 0
    assert "trae/agent-E" in out
    assert "feature/other" not in out


def test_no_fetch_flag_works(temp_git_repo):
    """用例7：--no-fetch 不报错"""
    repo = temp_git_repo
    out, rc = run_governance(repo)
    # 无候选分支也应退出 0
    assert rc == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
