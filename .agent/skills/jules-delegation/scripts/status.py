#!/usr/bin/env python3
"""
ステータス確認スクリプト
委任したタスクのステータスを確認する
"""

import sys
import argparse
from pathlib import Path

# srcディレクトリをパスに追加
# srcディレクトリをパスに追加
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.task_dispatcher import create_dispatcher_from_config
from src.jules_client import JulesAPIError
from src.utils import checkout_jules_branch, find_jules_branch, get_current_branch


def main():
    parser = argparse.ArgumentParser(description="委任タスクのステータスを確認")
    parser.add_argument("--config", default="config.json", help="設定ファイルパス")
    parser.add_argument("--check", "-c", action="store_true", help="アクティブセッションを更新確認")
    parser.add_argument("--approve", "-a", help="指定セッションのプランを承認")
    parser.add_argument("--checkout", help="Julesブランチにチェックアウト（セッションID指定、または 'latest' で最新）")
    parser.add_argument("--show-branch", action="store_true", help="現在のブランチとJulesブランチを表示")
    
    args = parser.parse_args()
    
    try:
        # ブランチ情報表示
        if args.show_branch:
            current = get_current_branch()
            print(f"現在のブランチ: {current or '(検出失敗)'}")
            
            jules_branch = find_jules_branch()
            if jules_branch:
                print(f"Julesブランチ: {jules_branch}")
            else:
                print("Julesブランチ: (見つかりません)")
            return
        
        # Julesブランチへチェックアウト
        if args.checkout:
            print("Julesのブランチを検索中...")
            session_id = None if args.checkout == "latest" else args.checkout
            success, message = checkout_jules_branch(session_id=session_id)
            if success:
                print(f"✅ {message}")
            else:
                print(f"❌ {message}")
            return
        
        dispatcher = create_dispatcher_from_config(args.config)
        
        # プラン承認
        if args.approve:
            print(f"プランを承認中: {args.approve}")
            session = dispatcher.approve_session(args.approve)
            print(f"承認完了: 状態 → {session.state.value}")
            return
        
        # アクティブセッションを更新
        if args.check:
            completed = dispatcher.check_active_sessions()
            if completed:
                print(f"{len(completed)}件のセッションが完了しました:")
                for record in completed:
                    emoji = "✅" if record.state == "COMPLETED" else "❌"
                    print(f"  {emoji} {record.task_definition.title}")
                    if record.pull_request_url:
                        print(f"     PR: {record.pull_request_url}")
                print()
        
        # ステータスレポート
        report = dispatcher.get_status_report()
        print(report)
        
    except FileNotFoundError:
        print("エラー: config.json が見つかりません")
        sys.exit(1)
    except JulesAPIError as e:
        print(f"Jules APIエラー: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"エラー: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
