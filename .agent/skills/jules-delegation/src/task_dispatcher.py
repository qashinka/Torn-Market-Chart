"""
タスク分配モジュール
Antigravityのレート制限を監視し、Julesへのタスク委任を管理する

正式なJules API (jules.googleapis.com) を使用
"""

import time
import json
from typing import List, Dict, Any, Optional, Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .jules_client import (
    JulesClient, 
    Session, 
    SessionState, 
    AutomationMode,
    JulesAPIError,
    Source
)
from .task_analyzer import TaskDefinition, TaskAnalyzer


@dataclass
class DelegationRecord:
    """委任記録"""
    task_definition: TaskDefinition
    session_name: str
    session_url: str
    delegated_at: datetime
    completed_at: Optional[datetime] = None
    state: str = "QUEUED"
    pull_request_url: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "task": self.task_definition.to_dict(),
            "session_name": self.session_name,
            "session_url": self.session_url,
            "delegated_at": self.delegated_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "state": self.state,
            "pull_request_url": self.pull_request_url
        }


class TaskDispatcher:
    """
    タスク分配器
    
    Antigravityからのタスクを受け取り、Julesに委任して結果を取得する
    """
    
    def __init__(
        self,
        jules_client: JulesClient,
        default_source: Optional[str] = None,
        history_path: Optional[str] = None,
        polling_interval: int = 30
    ):
        """
        Args:
            jules_client: Jules APIクライアント
            default_source: デフォルトのソース名 (format: "sources/{source_id}")
            history_path: 委任履歴の保存パス
            polling_interval: ポーリング間隔（秒）
        """
        self.client = jules_client
        self.default_source = default_source
        self.history_path = Path(history_path) if history_path else None
        self.polling_interval = polling_interval
        self.analyzer = TaskAnalyzer()
        self.active_sessions: Dict[str, DelegationRecord] = {}
        self.completed_sessions: List[DelegationRecord] = []
        
        # 履歴を読み込み
        if self.history_path and self.history_path.exists():
            self._load_history()
    
    def list_available_sources(self) -> List[Source]:
        """
        利用可能なソース（リポジトリ）一覧を取得
        
        Returns:
            ソースのリスト
        """
        return self.client.list_sources()
    
    def auto_detect_source(self) -> Optional[str]:
        """
        GitリモートURLからソースを自動検出
        
        Returns:
            ソース名（見つからない場合はNone）
        """
        from .utils import get_github_repo_name
        
        repo_name = get_github_repo_name()
        if not repo_name:
            return None
        
        # sources一覧から一致するものを検索
        try:
            sources = self.client.list_sources()
            for source in sources:
                # display_nameまたはnameにリポジトリ名が含まれるか確認
                if repo_name.lower() in source.display_name.lower() or repo_name.lower() in source.name.lower():
                    return source.name
        except Exception:
            pass
        
        return None
    
    def delegate(
        self,
        request: str,
        source: Optional[str] = None,
        starting_branch: Optional[str] = None,
        context: Optional[str] = None,
        require_plan_approval: bool = True,
        wait_for_completion: bool = False,
        auto_approve: bool = False,
        on_progress: Optional[Callable[[Session], None]] = None
    ) -> DelegationRecord:
        """
        タスクをJulesに委任
        
        Args:
            request: タスクの説明
            source: ソース名（省略時は自動検出 → default_source）
            starting_branch: 開始ブランチ（省略時は現在のブランチを自動検出）
            context: コンテキスト情報
            require_plan_approval: プラン承認を必要とするか
            wait_for_completion: 完了まで待機するか
            auto_approve: プランを自動承認するか
            on_progress: 進捗コールバック
            
        Returns:
            委任記録
        """
        from .utils import get_current_branch
        
        # ソースを決定（自動検出 → default_source → エラー）
        target_source = source
        if not target_source:
            target_source = self.auto_detect_source()
            if target_source:
                print(f"ソースを自動検出: {target_source}")
        if not target_source:
            target_source = self.default_source
        if not target_source:
            raise JulesAPIError("ソースが指定されていません。config.jsonでdefault_sourceを設定するか、引数で指定してください。")
        
        # ブランチを決定（自動検出 → "main"）
        target_branch = starting_branch
        if not target_branch:
            target_branch = get_current_branch()
            if target_branch:
                print(f"ブランチを自動検出: {target_branch}")
            else:
                target_branch = "main"
        
        # タスクを分析
        task_def = self.analyzer.analyze_and_create(request, context)
        
        # プロンプトを生成
        prompt = task_def.to_jules_prompt()
        
        # セッションを作成
        session = self.client.create_session(
            prompt=prompt,
            source=target_source,
            starting_branch=target_branch,
            title=task_def.title,
            require_plan_approval=require_plan_approval,
            automation_mode=AutomationMode.AUTO_CREATE_PR
        )
        
        # 記録を作成
        record = DelegationRecord(
            task_definition=task_def,
            session_name=session.name,
            session_url=session.url,
            delegated_at=datetime.now(),
            state=session.state.value
        )
        
        self.active_sessions[session.name] = record
        self._save_history()
        
        print(f"✓ セッション作成: {session.url}")
        
        if wait_for_completion:
            record = self._wait_and_update(record, auto_approve, on_progress)
        
        return record
    
    def _wait_and_update(
        self,
        record: DelegationRecord,
        auto_approve: bool = False,
        on_progress: Optional[Callable[[Session], None]] = None
    ) -> DelegationRecord:
        """完了まで待機して記録を更新"""
        try:
            while True:
                session = self.client.get_session(record.session_name)
                record.state = session.state.value
                
                if on_progress:
                    on_progress(session)
                
                # プラン承認待ちで自動承認が有効な場合
                if session.is_waiting_approval() and auto_approve:
                    print("プランを自動承認中...")
                    session = self.client.approve_plan(record.session_name)
                    record.state = session.state.value
                
                if session.is_terminal():
                    record.completed_at = datetime.now()
                    
                    # PRがあれば記録
                    if session.outputs:
                        for output in session.outputs:
                            if output.pull_request:
                                record.pull_request_url = output.pull_request.url
                                break
                    
                    # アクティブから完了へ移動
                    del self.active_sessions[record.session_name]
                    self.completed_sessions.append(record)
                    self._save_history()
                    
                    return record
                
                time.sleep(self.polling_interval)
                
        except JulesAPIError as e:
            record.state = "ERROR"
            return record
    
    def check_active_sessions(self) -> List[DelegationRecord]:
        """
        アクティブなセッションのステータスを確認
        
        Returns:
            完了したセッションのリスト
        """
        completed = []
        
        for session_name, record in list(self.active_sessions.items()):
            try:
                session = self.client.get_session(session_name)
                record.state = session.state.value
                
                if session.is_terminal():
                    record.completed_at = datetime.now()
                    
                    if session.outputs:
                        for output in session.outputs:
                            if output.pull_request:
                                record.pull_request_url = output.pull_request.url
                                break
                    
                    del self.active_sessions[session_name]
                    self.completed_sessions.append(record)
                    completed.append(record)
                    
            except JulesAPIError as e:
                print(f"セッション {session_name} のステータス確認エラー: {e}")
        
        if completed:
            self._save_history()
        
        return completed
    
    def approve_session(self, session_name: str) -> Session:
        """
        セッションのプランを承認
        
        Args:
            session_name: セッション名
            
        Returns:
            更新されたセッション
        """
        session = self.client.approve_plan(session_name)
        
        if session_name in self.active_sessions:
            self.active_sessions[session_name].state = session.state.value
            self._save_history()
        
        return session
    
    def get_status_report(self) -> str:
        """ステータスレポートを生成"""
        lines = ["# タスク委任ステータス", ""]
        
        lines.append(f"## アクティブなセッション ({len(self.active_sessions)}件)")
        if self.active_sessions:
            for session_name, record in self.active_sessions.items():
                state_emoji = {
                    "QUEUED": "⏳",
                    "PLANNING": "📝",
                    "AWAITING_PLAN_APPROVAL": "⏸️",
                    "IN_PROGRESS": "🔄",
                }.get(record.state, "❓")
                lines.append(f"- {state_emoji} [{record.task_definition.title}]({record.session_url})")
                lines.append(f"  - 状態: {record.state}")
        else:
            lines.append("なし")
        
        lines.append("")
        lines.append(f"## 完了したセッション ({len(self.completed_sessions)}件)")
        if self.completed_sessions:
            for record in self.completed_sessions[-5:]:  # 最新5件
                state_emoji = "✅" if record.state == "COMPLETED" else "❌"
                lines.append(f"- {state_emoji} {record.task_definition.title}")
                if record.pull_request_url:
                    lines.append(f"  - PR: {record.pull_request_url}")
        else:
            lines.append("なし")
        
        return "\n".join(lines)
    
    def _save_history(self):
        """履歴を保存"""
        if not self.history_path:
            return
        
        data = {
            "active": {k: v.to_dict() for k, v in self.active_sessions.items()},
            "completed": [r.to_dict() for r in self.completed_sessions[-50:]]  # 最新50件
        }
        
        self.history_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.history_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    
    def _load_history(self):
        """履歴を読み込み"""
        # 簡易実装: 再起動時はアクティブセッションをリセット
        # 完全な実装ではセッション名から再取得する
        pass


def create_dispatcher_from_config(config_path: str = "config.json") -> TaskDispatcher:
    """
    設定ファイルからディスパッチャーを作成
    
    Args:
        config_path: 設定ファイルのパス
        
    Returns:
        TaskDispatcherインスタンス
    """
    from .jules_client import create_client_from_config, load_config
    
    config = load_config(config_path)
    client = create_client_from_config(config_path)
    
    return TaskDispatcher(
        jules_client=client,
        default_source=config.get("default_source"),
        history_path=config.get("history_path", ".jules_history.json"),
        polling_interval=config.get("polling_interval_seconds", 30)
    )
