"""
Jules API クライアント
正式なJules API (jules.googleapis.com) との通信を担当するモジュール

API Reference: https://developers.google.com/jules/api/reference/rest
"""

import json
import time
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from enum import Enum


class SessionState(Enum):
    """Julesセッションのステータス"""
    STATE_UNSPECIFIED = "STATE_UNSPECIFIED"
    QUEUED = "QUEUED"
    PLANNING = "PLANNING"
    AWAITING_PLAN_APPROVAL = "AWAITING_PLAN_APPROVAL"
    AWAITING_USER_FEEDBACK = "AWAITING_USER_FEEDBACK"
    IN_PROGRESS = "IN_PROGRESS"
    PAUSED = "PAUSED"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"


class AutomationMode(Enum):
    """自動化モード"""
    AUTOMATION_MODE_UNSPECIFIED = "AUTOMATION_MODE_UNSPECIFIED"
    AUTO_CREATE_PR = "AUTO_CREATE_PR"


@dataclass
class PullRequest:
    """プルリクエスト情報"""
    url: str
    title: str
    description: str = ""


@dataclass
class SessionOutput:
    """セッション出力"""
    pull_request: Optional[PullRequest] = None


@dataclass
class GitHubRepoContext:
    """GitHubリポジトリコンテキスト"""
    starting_branch: str = "main"


@dataclass
class SourceContext:
    """ソースコンテキスト"""
    source: str  # format: "sources/{source_id}"
    github_repo_context: Optional[GitHubRepoContext] = None


@dataclass
class Session:
    """
    Julesセッション
    
    API Reference: https://developers.google.com/jules/api/reference/rest/v1alpha/sessions
    """
    name: str = ""  # format: "sessions/{session_id}"
    id: str = ""
    prompt: str = ""
    source_context: Optional[SourceContext] = None
    title: str = ""
    require_plan_approval: bool = False
    automation_mode: AutomationMode = AutomationMode.AUTOMATION_MODE_UNSPECIFIED
    create_time: str = ""
    update_time: str = ""
    state: SessionState = SessionState.STATE_UNSPECIFIED
    url: str = ""
    outputs: List[SessionOutput] = field(default_factory=list)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Session":
        """APIレスポンスからSessionを生成"""
        outputs = []
        for output_data in data.get("outputs", []):
            pr_data = output_data.get("pullRequest")
            if pr_data:
                pr = PullRequest(
                    url=pr_data.get("url", ""),
                    title=pr_data.get("title", ""),
                    description=pr_data.get("description", "")
                )
                outputs.append(SessionOutput(pull_request=pr))
        
        source_context = None
        sc_data = data.get("sourceContext")
        if sc_data:
            gh_context = None
            gh_data = sc_data.get("githubRepoContext")
            if gh_data:
                gh_context = GitHubRepoContext(
                    starting_branch=gh_data.get("startingBranch", "main")
                )
            source_context = SourceContext(
                source=sc_data.get("source", ""),
                github_repo_context=gh_context
            )
        
        state_str = data.get("state", "STATE_UNSPECIFIED")
        try:
            state = SessionState(state_str)
        except ValueError:
            state = SessionState.STATE_UNSPECIFIED
        
        automation_str = data.get("automationMode", "AUTOMATION_MODE_UNSPECIFIED")
        try:
            automation = AutomationMode(automation_str)
        except ValueError:
            automation = AutomationMode.AUTOMATION_MODE_UNSPECIFIED
        
        return cls(
            name=data.get("name", ""),
            id=data.get("id", ""),
            prompt=data.get("prompt", ""),
            source_context=source_context,
            title=data.get("title", ""),
            require_plan_approval=data.get("requirePlanApproval", False),
            automation_mode=automation,
            create_time=data.get("createTime", ""),
            update_time=data.get("updateTime", ""),
            state=state,
            url=data.get("url", ""),
            outputs=outputs
        )
    
    def is_terminal(self) -> bool:
        """終了状態かどうか"""
        return self.state in (SessionState.COMPLETED, SessionState.FAILED)
    
    def is_waiting_approval(self) -> bool:
        """承認待ちかどうか"""
        return self.state == SessionState.AWAITING_PLAN_APPROVAL


@dataclass
class Source:
    """ソース（GitHubリポジトリなど）"""
    name: str  # format: "sources/{source_id}"
    display_name: str = ""
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Source":
        return cls(
            name=data.get("name", ""),
            display_name=data.get("displayName", "")
        )


class JulesClient:
    """
    Jules APIクライアント
    
    Jules API (jules.googleapis.com) と通信してセッションの作成・監視・結果取得を行う
    
    API Reference: https://developers.google.com/jules/api/reference/rest
    """
    
    BASE_URL = "https://jules.googleapis.com/v1alpha"
    
    def __init__(self, api_key: str):
        """
        クライアントを初期化
        
        Args:
            api_key: Jules APIキー（またはOAuthトークン）
        """
        self.api_key = api_key
        self._sources_cache: Optional[List[Source]] = None
    
    def _get_headers(self) -> Dict[str, str]:
        """APIリクエスト用ヘッダーを取得"""
        return {
            "X-Goog-Api-Key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
    
    def _request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict[str, Any]:
        """
        APIリクエストを送信
        
        Args:
            method: HTTPメソッド
            endpoint: APIエンドポイント（v1alpha/以降）
            data: リクエストボディ
            
        Returns:
            レスポンスのJSON
        """
        import requests
        
        url = f"{self.BASE_URL}/{endpoint}"
        
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self._get_headers(),
                json=data,
                timeout=30
            )
            response.raise_for_status()
            return response.json() if response.text else {}
        except requests.exceptions.RequestException as e:
            raise JulesAPIError(f"APIリクエストエラー: {e}")
    
    # ==================== Sources API ====================
    
    def list_sources(self) -> List[Source]:
        """
        登録済みソース（リポジトリ）一覧を取得
        
        Returns:
            ソースのリスト
        """
        response = self._request("GET", "sources")
        sources = [Source.from_dict(s) for s in response.get("sources", [])]
        self._sources_cache = sources
        return sources
    
    def get_source(self, source_name: str) -> Source:
        """
        ソースを取得
        
        Args:
            source_name: ソース名 (format: "sources/{source_id}")
            
        Returns:
            ソース情報
        """
        # source_nameから"sources/"プレフィックスを除去
        endpoint = source_name if source_name.startswith("sources/") else f"sources/{source_name}"
        response = self._request("GET", endpoint)
        return Source.from_dict(response)
    
    def find_source_by_repo(self, repo_name: str) -> Optional[Source]:
        """
        リポジトリ名でソースを検索
        
        Args:
            repo_name: リポジトリ名（例: "owner/repo"）
            
        Returns:
            見つかったソース、なければNone
        """
        sources = self._sources_cache or self.list_sources()
        for source in sources:
            if repo_name in source.display_name or repo_name in source.name:
                return source
        return None
    
    # ==================== Sessions API ====================
    
    def create_session(
        self,
        prompt: str,
        source: str,
        starting_branch: str = "main",
        title: Optional[str] = None,
        require_plan_approval: bool = True,
        automation_mode: AutomationMode = AutomationMode.AUTO_CREATE_PR
    ) -> Session:
        """
        新しいセッションを作成
        
        Args:
            prompt: タスクの説明
            source: ソース名 (format: "sources/{source_id}")
            starting_branch: 開始ブランチ
            title: セッションタイトル（オプション）
            require_plan_approval: プラン承認を必要とするか
            automation_mode: 自動化モード
            
        Returns:
            作成されたセッション
        """
        data = {
            "prompt": prompt,
            "sourceContext": {
                "source": source,
                "githubRepoContext": {
                    "startingBranch": starting_branch
                }
            },
            "requirePlanApproval": require_plan_approval,
            "automationMode": automation_mode.value
        }
        
        if title:
            data["title"] = title
        
        response = self._request("POST", "sessions", data)
        return Session.from_dict(response)
    
    def get_session(self, session_name: str) -> Session:
        """
        セッションを取得
        
        Args:
            session_name: セッション名 (format: "sessions/{session_id}")
            
        Returns:
            セッション情報
        """
        endpoint = session_name if session_name.startswith("sessions/") else f"sessions/{session_name}"
        response = self._request("GET", endpoint)
        return Session.from_dict(response)
    
    def list_sessions(self) -> List[Session]:
        """
        セッション一覧を取得
        
        Returns:
            セッションのリスト
        """
        response = self._request("GET", "sessions")
        return [Session.from_dict(s) for s in response.get("sessions", [])]
    
    def approve_plan(self, session_name: str) -> Session:
        """
        セッションのプランを承認
        
        Args:
            session_name: セッション名
            
        Returns:
            更新されたセッション
        """
        endpoint = session_name if session_name.startswith("sessions/") else f"sessions/{session_name}"
        response = self._request("POST", f"{endpoint}:approvePlan")
        return Session.from_dict(response)
    
    def send_message(self, session_name: str, message: str) -> Session:
        """
        セッションにメッセージを送信
        
        Args:
            session_name: セッション名
            message: 送信するメッセージ
            
        Returns:
            更新されたセッション
        """
        endpoint = session_name if session_name.startswith("sessions/") else f"sessions/{session_name}"
        data = {"message": message}
        response = self._request("POST", f"{endpoint}:sendMessage", data)
        return Session.from_dict(response)
    
    def wait_for_completion(
        self, 
        session_name: str, 
        polling_interval: int = 30, 
        timeout: int = 3600,
        auto_approve: bool = False
    ) -> Session:
        """
        セッションの完了を待機
        
        Args:
            session_name: セッション名
            polling_interval: ポーリング間隔（秒）
            timeout: タイムアウト（秒）
            auto_approve: プラン承認を自動で行うか
            
        Returns:
            完了したセッション
        """
        start_time = time.time()
        
        while True:
            session = self.get_session(session_name)
            
            # プラン承認待ちで自動承認が有効な場合
            if session.is_waiting_approval() and auto_approve:
                session = self.approve_plan(session_name)
            
            if session.is_terminal():
                return session
            
            if time.time() - start_time > timeout:
                raise JulesAPIError(f"セッション {session_name} がタイムアウトしました")
            
            time.sleep(polling_interval)


class JulesAPIError(Exception):
    """Jules APIエラー"""
    pass


def load_config(config_path: str = "config.json") -> Dict[str, Any]:
    """
    設定ファイルを読み込む
    
    Args:
        config_path: 設定ファイルのパス
        
    Returns:
        設定辞書
    """
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def create_client_from_config(config_path: str = "config.json") -> JulesClient:
    """
    設定ファイルからクライアントを作成
    
    Args:
        config_path: 設定ファイルのパス
        
    Returns:
        JulesClientインスタンス
    """
    config = load_config(config_path)
    return JulesClient(api_key=config["jules_api_key"])
