#!/usr/bin/env python3
"""
タスク委任スクリプト
Antigravityから呼び出してJulesにタスクを委任する

レート制限対策のスマートデフォルト機能付き
"""

import sys
import argparse
from pathlib import Path

# srcディレクトリをパスに追加
# srcディレクトリをパスに追加
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.task_dispatcher import create_dispatcher_from_config
from src.jules_client import JulesAPIError
from src.utils import get_current_branch, checkout_jules_branch, sync_before_jules
from src.task_analyzer import (
    TaskAnalyzer, 
    ExecutionMode, 
    get_execution_recommendation
)


def main():
    parser = argparse.ArgumentParser(description="Julesにタスクを委任")
    parser.add_argument("description", nargs="?", help="タスクの説明")
    parser.add_argument("--source", "-s", help="ソース名 (format: sources/{source_id})")
    parser.add_argument("--branch", "-b", help="開始ブランチ（省略時は現在のブランチを自動検出）")
    parser.add_argument("--context", "-c", help="コンテキスト情報")
    
    # 実行オプション（手動指定時はスマートデフォルトを上書き）
    parser.add_argument("--wait", "-w", action="store_true", help="完了まで待機")
    parser.add_argument("--auto-approve", "-a", action="store_true", help="プランを自動承認")
    parser.add_argument("--checkout", action="store_true", help="完了後にJulesのブランチにチェックアウト")
    parser.add_argument("--no-smart", action="store_true", help="スマートデフォルトを無効化")
    
    # 同期オプション
    parser.add_argument("--no-sync", action="store_true", help="事前のコミット・プッシュをスキップ")
    parser.add_argument("--commit-message", "-m", help="自動コミットのメッセージ")
    
    # その他
    parser.add_argument("--config", default="config.json", help="設定ファイルパス")
    parser.add_argument("--list-sources", action="store_true", help="利用可能なソース一覧を表示")
    
    args = parser.parse_args()
    
    try:
        dispatcher = create_dispatcher_from_config(args.config)
        
        # ソース一覧を表示
        if args.list_sources:
            print("利用可能なソース:")
            sources = dispatcher.list_available_sources()
            if sources:
                for source in sources:
                    print(f"  - {source.name}")
                    if source.display_name:
                        print(f"    ({source.display_name})")
            else:
                print("  (なし)")
            return
        
        # タスク説明が必須
        if not args.description:
            parser.error("タスクの説明を指定してください（または --list-sources で一覧表示）")
        
        # スマートデフォルトを適用（手動指定がなければ）
        wait = args.wait
        auto_approve = args.auto_approve
        checkout = args.checkout
        
        if not args.no_smart and not any([args.wait, args.auto_approve, args.checkout]):
            # タスクを分析して推奨設定を取得
            analyzer = TaskAnalyzer()
            task_def = analyzer.analyze_and_create(args.description, args.context)
            recommendation = get_execution_recommendation(task_def, rate_limit_mode=True)
            
            print(f"\n🧠 スマートデフォルト適用:")
            print(f"   戦略: {recommendation.reason}")
            
            wait = recommendation.mode == ExecutionMode.WAIT_FOR_COMPLETION
            auto_approve = recommendation.auto_approve
            checkout = recommendation.checkout_after
            
            if recommendation.to_cli_args():
                print(f"   オプション: {recommendation.to_cli_args()}")
        
        # ブランチを決定（指定がなければ現在のブランチを自動検出）
        branch = args.branch
        if not branch:
            branch = get_current_branch()
            if branch:
                print(f"\n📍 現在のブランチ: {branch}")
            else:
                branch = "main"
                print(f"\n📍 ブランチ検出失敗、デフォルト使用: {branch}")
        
        # 事前にコミット・プッシュを実行
        if not args.no_sync:
            print("\n📦 リポジトリを同期中...")
            success, message = sync_before_jules(
                commit_message=args.commit_message
            )
            if success:
                print(f"   {message}")
            else:
                print(f"❌ 同期失敗: {message}")
                print("   --no-sync オプションでスキップできます")
                sys.exit(1)
        
        print(f"\n🚀 タスクを委任中: {args.description[:50]}...")
        
        record = dispatcher.delegate(
            request=args.description,
            source=args.source,
            starting_branch=branch,
            context=args.context,
            wait_for_completion=wait,
            auto_approve=auto_approve
        )
        
        print(f"\n✅ 委任完了!")
        print(f"   セッション: {record.session_name}")
        print(f"   状態: {record.state}")
        print(f"   URL: {record.session_url}")
        
        if record.pull_request_url:
            print(f"   PR: {record.pull_request_url}")
        
        # 完了後にJulesブランチへチェックアウト
        if checkout and record.state == "COMPLETED":
            print("\n🔀 Julesのブランチにチェックアウト中...")
            session_id = record.session_name.split("/")[-1] if "/" in record.session_name else record.session_name
            success, message = checkout_jules_branch(session_id=session_id)
            if success:
                print(f"   ✅ {message}")
            else:
                print(f"   ⚠️ {message}")
            
    except FileNotFoundError:
        print("エラー: config.json が見つかりません")
        print("config.example.json を参考に設定ファイルを作成してください")
        sys.exit(1)
    except JulesAPIError as e:
        print(f"Jules APIエラー: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"エラー: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
