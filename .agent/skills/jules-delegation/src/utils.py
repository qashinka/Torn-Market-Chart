"""
ユーティリティ関数
"""

import json
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, Tuple


def load_json(path: str) -> Dict[str, Any]:
    """JSONファイルを読み込む"""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data: Dict[str, Any], indent: int = 2) -> None:
    """JSONファイルに保存"""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)


def find_project_root(start_path: Optional[str] = None) -> Optional[Path]:
    """
    プロジェクトルートを検索
    
    .git, package.json, pyproject.toml などを目印に検索
    """
    current = Path(start_path) if start_path else Path.cwd()
    
    markers = [".git", "package.json", "pyproject.toml", "Cargo.toml", ".agent"]
    
    while current != current.parent:
        for marker in markers:
            if (current / marker).exists():
                return current
        current = current.parent
    
    return None


def format_file_list(files: list, max_display: int = 10) -> str:
    """ファイルリストを整形"""
    if not files:
        return "(なし)"
    
    if len(files) <= max_display:
        return "\n".join(f"- {f}" for f in files)
    
    display_files = files[:max_display]
    remaining = len(files) - max_display
    
    lines = [f"- {f}" for f in display_files]
    lines.append(f"... 他 {remaining} ファイル")
    
    return "\n".join(lines)


# ==================== Git 関連ユーティリティ ====================

def get_git_remote_url(repo_path: Optional[str] = None) -> Optional[str]:
    """
    gitリモートURLを取得
    
    Returns:
        リモートURL、取得できない場合はNone
    """
    try:
        cwd = repo_path or str(Path.cwd())
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass
    return None


def get_github_repo_name(repo_path: Optional[str] = None) -> Optional[str]:
    """
    GitHubリポジトリ名を取得（owner/repo形式）
    
    Returns:
        リポジトリ名（例: "username/repo"）、取得できない場合はNone
    """
    url = get_git_remote_url(repo_path)
    if not url:
        return None
    
    # SSH形式: git@github.com:owner/repo.git
    if url.startswith("git@github.com:"):
        repo = url.replace("git@github.com:", "").rstrip(".git")
        return repo
    
    # HTTPS形式: https://github.com/owner/repo.git
    if "github.com/" in url:
        import re
        match = re.search(r"github\.com[/:]([^/]+/[^/]+?)(?:\.git)?$", url)
        if match:
            return match.group(1)
    
    return None


def get_current_branch(repo_path: Optional[str] = None) -> Optional[str]:
    """
    現在のGitブランチ名を取得
    
    Args:
        repo_path: リポジトリパス（省略時はカレントディレクトリ）
        
    Returns:
        ブランチ名、取得できない場合はNone
    """
    try:
        cwd = repo_path or str(Path.cwd())
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass
    return None


def git_fetch(repo_path: Optional[str] = None) -> bool:
    """
    git fetchを実行
    
    Returns:
        成功したかどうか
    """
    try:
        cwd = repo_path or str(Path.cwd())
        result = subprocess.run(
            ["git", "fetch", "--all"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=60
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


def git_checkout(branch: str, repo_path: Optional[str] = None) -> Tuple[bool, str]:
    """
    指定ブランチにチェックアウト
    
    Args:
        branch: ブランチ名
        repo_path: リポジトリパス
        
    Returns:
        (成功したか, メッセージ)
    """
    try:
        cwd = repo_path or str(Path.cwd())
        result = subprocess.run(
            ["git", "checkout", branch],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return True, f"ブランチ '{branch}' にチェックアウトしました"
        else:
            return False, result.stderr.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return False, str(e)


def get_remote_branches(repo_path: Optional[str] = None) -> list:
    """
    リモートブランチ一覧を取得
    
    Returns:
        ブランチ名のリスト
    """
    try:
        cwd = repo_path or str(Path.cwd())
        result = subprocess.run(
            ["git", "branch", "-r"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            branches = []
            for line in result.stdout.strip().split("\n"):
                branch = line.strip()
                if branch and "->" not in branch:  # origin/HEAD -> origin/main を除外
                    branches.append(branch)
            return branches
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass
    return []


def find_jules_branch(repo_path: Optional[str] = None, session_id: Optional[str] = None) -> Optional[str]:
    """
    Julesが作成したブランチを検索
    
    Julesは様々な形式のブランチ名を作成するため、
    以下の優先順位で検索:
    1. セッションIDに一致するブランチ
    2. 'jules/' または 'jules-' を含むブランチ
    3. main/master以外の最新ブランチ（PRブランチと想定）
    
    Args:
        repo_path: リポジトリパス
        session_id: セッションIDでフィルタ（オプション）
        
    Returns:
        見つかったブランチ名（origin/含む）
    """
    # まずfetchして最新のリモート情報を取得
    git_fetch(repo_path)
    
    branches = get_remote_branches(repo_path)
    
    # main/master を除外したブランチリスト
    non_main_branches = [b for b in branches if not any(
        main in b.lower() for main in ['origin/main', 'origin/master', 'origin/head']
    )]
    
    # セッションIDに一致するブランチを検索
    if session_id:
        for branch in non_main_branches:
            if session_id in branch:
                return branch
    
    # jules/ プレフィックスのブランチを検索
    jules_branches = [b for b in non_main_branches if "jules/" in b.lower() or "jules-" in b.lower()]
    if jules_branches:
        return jules_branches[-1]
    
    # main以外の最新ブランチを返す（PRブランチと想定）
    if non_main_branches:
        return non_main_branches[-1]
    
    return None


def checkout_jules_branch(
    repo_path: Optional[str] = None, 
    session_id: Optional[str] = None
) -> Tuple[bool, str]:
    """
    Julesが作成したブランチにチェックアウト
    
    Args:
        repo_path: リポジトリパス
        session_id: セッションID
        
    Returns:
        (成功したか, メッセージ)
    """
    branch = find_jules_branch(repo_path, session_id)
    
    if not branch:
        return False, "Julesのブランチが見つかりませんでした"
    
    # origin/を除いてローカルブランチ名にする
    local_branch = branch.replace("origin/", "")
    
    # チェックアウト（トラッキングブランチとして）
    try:
        cwd = repo_path or str(Path.cwd())
        result = subprocess.run(
            ["git", "checkout", "-b", local_branch, "--track", branch],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return True, f"ブランチ '{local_branch}' にチェックアウトしました"
        
        # 既にローカルブランチが存在する場合は通常のチェックアウト
        result = subprocess.run(
            ["git", "checkout", local_branch],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return True, f"ブランチ '{local_branch}' にチェックアウトしました"
        
        return False, result.stderr.strip()
        
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return False, str(e)


def git_add_all(repo_path: Optional[str] = None) -> Tuple[bool, str]:
    """
    全ファイルをステージング
    
    Returns:
        (成功したか, メッセージ)
    """
    try:
        cwd = repo_path or str(Path.cwd())
        result = subprocess.run(
            ["git", "add", "-A"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return True, "全ファイルをステージングしました"
        return False, result.stderr.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return False, str(e)


def git_commit(message: str, repo_path: Optional[str] = None) -> Tuple[bool, str]:
    """
    変更をコミット
    
    Args:
        message: コミットメッセージ
        
    Returns:
        (成功したか, メッセージ)
    """
    try:
        cwd = repo_path or str(Path.cwd())
        result = subprocess.run(
            ["git", "commit", "-m", message],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return True, "コミットしました"
        # 変更がない場合もエラーではない
        if "nothing to commit" in result.stdout or "nothing to commit" in result.stderr:
            return True, "コミットする変更はありません"
        return False, result.stderr.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return False, str(e)


def git_push(repo_path: Optional[str] = None) -> Tuple[bool, str]:
    """
    リモートにプッシュ
    
    Returns:
        (成功したか, メッセージ)
    """
    try:
        cwd = repo_path or str(Path.cwd())
        result = subprocess.run(
            ["git", "push"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=60
        )
        if result.returncode == 0:
            return True, "プッシュしました"
        return False, result.stderr.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return False, str(e)


def git_has_changes(repo_path: Optional[str] = None) -> bool:
    """
    未コミットの変更があるかチェック
    
    Returns:
        変更がある場合True
    """
    try:
        cwd = repo_path or str(Path.cwd())
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10
        )
        return bool(result.stdout.strip())
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


def sync_before_jules(
    repo_path: Optional[str] = None,
    commit_message: Optional[str] = None,
    auto_commit: bool = True
) -> Tuple[bool, str]:
    """
    Julesに作業させる前にコミットと同期を行う
    
    Args:
        repo_path: リポジトリパス
        commit_message: コミットメッセージ（省略時は自動生成）
        auto_commit: 自動でコミットするか（Falseの場合は確認のみ）
        
    Returns:
        (成功したか, メッセージ)
    """
    messages = []
    
    # 変更があるかチェック
    has_changes = git_has_changes(repo_path)
    
    if has_changes:
        if not auto_commit:
            return False, "未コミットの変更があります。コミットしてからJulesに委任してください。"
        
        # ステージング
        success, msg = git_add_all(repo_path)
        if not success:
            return False, f"ステージング失敗: {msg}"
        messages.append(msg)
        
        # コミット
        if not commit_message:
            commit_message = "WIP: Before Jules delegation"
        
        success, msg = git_commit(commit_message, repo_path)
        if not success:
            return False, f"コミット失敗: {msg}"
        messages.append(msg)
    else:
        messages.append("コミットする変更はありません")
    
    # プッシュ
    success, msg = git_push(repo_path)
    if not success:
        return False, f"プッシュ失敗: {msg}"
    messages.append(msg)
    
    return True, " → ".join(messages)
