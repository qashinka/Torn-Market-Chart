"""
動的タスク分析モジュール
Antigravityがその場でタスクを分解してJules向けに変換する
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from enum import Enum


class TaskType(Enum):
    """タスクの種類"""
    IMPLEMENTATION = "implementation"  # コード実装
    TEST = "test"                      # テスト作成
    REFACTOR = "refactor"              # リファクタリング
    DOCS = "docs"                      # ドキュメント
    FIX = "fix"                        # バグ修正
    REVIEW = "review"                  # コードレビュー


class TaskPriority(Enum):
    """タスクの優先度"""
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4


class ExecutionMode(Enum):
    """実行モード（レート制限対策を考慮）"""
    FIRE_AND_FORGET = "fire_and_forget"  # 委任して即座に戻る（レート対策に最適）
    WAIT_FOR_PLAN = "wait_for_plan"       # プラン承認まで待機
    WAIT_FOR_COMPLETION = "wait_for_completion"  # 完了まで待機


@dataclass
class ExecutionRecommendation:
    """
    実行推奨設定
    
    タスク内容から自動的に最適な実行方法を判断
    """
    mode: ExecutionMode
    auto_approve: bool
    checkout_after: bool
    reason: str
    
    def to_cli_args(self) -> str:
        """CLIオプションに変換"""
        args = []
        if self.mode == ExecutionMode.WAIT_FOR_COMPLETION:
            args.append("--wait")
        if self.auto_approve:
            args.append("--auto-approve")
        if self.checkout_after:
            args.append("--checkout")
        return " ".join(args)


@dataclass
class TaskDefinition:
    """
    Julesに委任するタスクの定義
    
    Antigravityが分析した結果をこの形式でJulesに渡す
    """
    title: str
    description: str
    task_type: TaskType
    priority: TaskPriority = TaskPriority.MEDIUM
    target_files: List[str] = field(default_factory=list)
    context: str = ""
    acceptance_criteria: List[str] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)
    
    def to_jules_prompt(self) -> str:
        """Jules向けのプロンプトを生成"""
        prompt_parts = [
            f"# タスク: {self.title}",
            "",
            f"## 概要",
            self.description,
            "",
        ]
        
        if self.context:
            prompt_parts.extend([
                "## コンテキスト",
                self.context,
                "",
            ])
        
        if self.target_files:
            prompt_parts.extend([
                "## 対象ファイル",
                *[f"- {f}" for f in self.target_files],
                "",
            ])
        
        if self.acceptance_criteria:
            prompt_parts.extend([
                "## 完了条件",
                *[f"- {c}" for c in self.acceptance_criteria],
                "",
            ])
        
        return "\n".join(prompt_parts)
    
    def to_dict(self) -> Dict[str, Any]:
        """辞書形式に変換"""
        return {
            "title": self.title,
            "description": self.description,
            "task_type": self.task_type.value,
            "priority": self.priority.value,
            "target_files": self.target_files,
            "context": self.context,
            "acceptance_criteria": self.acceptance_criteria,
            "dependencies": self.dependencies
        }


class TaskAnalyzer:
    """
    タスク分析器
    
    Antigravityからの指示を分析し、Jules向けのタスク定義に変換する
    """
    
    def __init__(self):
        self.task_history: List[TaskDefinition] = []
    
    def analyze_and_create(
        self,
        user_request: str,
        current_context: Optional[str] = None,
        available_files: Optional[List[str]] = None
    ) -> TaskDefinition:
        """
        ユーザーリクエストを分析してタスク定義を作成
        
        Args:
            user_request: ユーザー（Antigravity）からのリクエスト
            current_context: 現在のコンテキスト情報
            available_files: 利用可能なファイルリスト
            
        Returns:
            タスク定義
        """
        # タスクタイプを推定
        task_type = self._infer_task_type(user_request)
        
        # 優先度を推定
        priority = self._infer_priority(user_request)
        
        # 対象ファイルを抽出
        target_files = self._extract_target_files(user_request, available_files or [])
        
        # 完了条件を生成
        acceptance_criteria = self._generate_acceptance_criteria(user_request, task_type)
        
        task = TaskDefinition(
            title=self._generate_title(user_request),
            description=user_request,
            task_type=task_type,
            priority=priority,
            target_files=target_files,
            context=current_context or "",
            acceptance_criteria=acceptance_criteria
        )
        
        self.task_history.append(task)
        return task
    
    def _infer_task_type(self, request: str) -> TaskType:
        """リクエストからタスクタイプを推定"""
        request_lower = request.lower()
        
        patterns = {
            TaskType.TEST: ["テスト", "test", "spec", "検証"],
            TaskType.FIX: ["修正", "fix", "バグ", "bug", "エラー", "error"],
            TaskType.REFACTOR: ["リファクタ", "refactor", "整理", "cleanup", "改善"],
            TaskType.DOCS: ["ドキュメント", "document", "readme", "説明", "コメント"],
            TaskType.REVIEW: ["レビュー", "review", "確認", "チェック"],
        }
        
        for task_type, keywords in patterns.items():
            if any(kw in request_lower for kw in keywords):
                return task_type
        
        return TaskType.IMPLEMENTATION
    
    def _infer_priority(self, request: str) -> TaskPriority:
        """リクエストから優先度を推定"""
        request_lower = request.lower()
        
        if any(kw in request_lower for kw in ["緊急", "urgent", "critical", "asap", "今すぐ"]):
            return TaskPriority.CRITICAL
        elif any(kw in request_lower for kw in ["重要", "important", "high", "優先"]):
            return TaskPriority.HIGH
        elif any(kw in request_lower for kw in ["後で", "later", "low", "余裕"]):
            return TaskPriority.LOW
        
        return TaskPriority.MEDIUM
    
    def _extract_target_files(self, request: str, available_files: List[str]) -> List[str]:
        """リクエストから対象ファイルを抽出"""
        target_files = []
        
        # ファイルパスっぽいパターンを検索
        import re
        file_patterns = re.findall(r'[\w\-./\\]+\.\w+', request)
        
        for pattern in file_patterns:
            # 利用可能なファイルと照合
            for f in available_files:
                if pattern in f or f.endswith(pattern):
                    target_files.append(f)
                    break
            else:
                # 利用可能ファイルになくても追加
                target_files.append(pattern)
        
        return target_files
    
    def _generate_title(self, request: str) -> str:
        """リクエストからタイトルを生成"""
        # 最初の一文または最大50文字
        first_line = request.split('\n')[0]
        if len(first_line) > 50:
            return first_line[:47] + "..."
        return first_line
    
    def _generate_acceptance_criteria(self, request: str, task_type: TaskType) -> List[str]:
        """タスクタイプに基づいて完了条件を生成"""
        base_criteria = ["要件通りに実装されている"]
        
        type_criteria = {
            TaskType.IMPLEMENTATION: ["コードがエラーなくビルドできる", "基本的な動作が確認できる"],
            TaskType.TEST: ["すべてのテストがパスする", "カバレッジが適切"],
            TaskType.REFACTOR: ["既存の機能が壊れていない", "コードの可読性が向上"],
            TaskType.DOCS: ["ドキュメントが正確", "必要な情報が網羅されている"],
            TaskType.FIX: ["報告された問題が解消", "リグレッションがない"],
            TaskType.REVIEW: ["問題点が特定されている", "改善提案が含まれる"]
        }
        
        return base_criteria + type_criteria.get(task_type, [])


def create_task_from_antigravity(
    request: str,
    context: Optional[str] = None,
    files: Optional[List[str]] = None
) -> TaskDefinition:
    """
    Antigravityからの指示を受けてタスクを作成するヘルパー関数
    
    Args:
        request: Antigravityからのリクエスト
        context: コンテキスト情報
        files: 対象ファイルリスト
        
    Returns:
        タスク定義
    """
    analyzer = TaskAnalyzer()
    return analyzer.analyze_and_create(request, context, files)


def get_execution_recommendation(
    task: TaskDefinition,
    rate_limit_mode: bool = True
) -> ExecutionRecommendation:
    """
    タスク内容から最適な実行設定を推奨
    
    Args:
        task: タスク定義
        rate_limit_mode: レート制限対策モード（Trueなら非同期を優先）
        
    Returns:
        実行推奨設定
    """
    # レート制限対策の基本方針:
    # - 大きなタスク → Fire and Forget（Julesにまかせて即戻る）
    # - 小さな修正 → 待機してもOK
    
    # タスクサイズの推定（説明文の長さとファイル数で判断）
    is_large_task = (
        len(task.description) > 200 or 
        len(task.target_files) > 3 or
        task.task_type == TaskType.IMPLEMENTATION
    )
    
    # 緊急度の判定
    is_urgent = task.priority in (TaskPriority.HIGH, TaskPriority.CRITICAL)
    
    # すぐに結果が必要なタスクタイプ
    needs_quick_result = task.task_type in (TaskType.FIX, TaskType.TEST)
    
    # レート制限対策モード
    if rate_limit_mode:
        if is_large_task:
            return ExecutionRecommendation(
                mode=ExecutionMode.FIRE_AND_FORGET,
                auto_approve=True,  # プラン承認も自動で
                checkout_after=False,
                reason="大きなタスクのため、Julesに任せてAntigravityは次の作業へ"
            )
        elif is_urgent or needs_quick_result:
            return ExecutionRecommendation(
                mode=ExecutionMode.WAIT_FOR_COMPLETION,
                auto_approve=True,
                checkout_after=True,
                reason="緊急または修正タスクのため、完了まで待機して結果を確認"
            )
        else:
            return ExecutionRecommendation(
                mode=ExecutionMode.FIRE_AND_FORGET,
                auto_approve=True,
                checkout_after=False,
                reason="レート制限対策のため、バックグラウンドで実行"
            )
    
    # 通常モード（レート制限を気にしない場合）
    if is_urgent:
        return ExecutionRecommendation(
            mode=ExecutionMode.WAIT_FOR_COMPLETION,
            auto_approve=False,  # 緊急なのでプランは確認
            checkout_after=True,
            reason="緊急タスクのため、完了まで待機"
        )
    
    return ExecutionRecommendation(
        mode=ExecutionMode.WAIT_FOR_PLAN,
        auto_approve=False,
        checkout_after=False,
        reason="標準的なタスク、プラン確認後に続行"
    )
