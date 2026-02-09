---
description: Julesにタスクを委任するワークフロー
---

# /delegate ワークフロー

Antigravityからこのワークフローを使用してJulesにタスクを委任する。

## 使用方法

ユーザーが `/delegate` と入力したとき、または委任が必要と判断したときにこのワークフローを実行。

## 手順

### 1. 委任するタスクを決定

ユーザーの要求を分析し、Julesに委任可能なタスクを特定する：

- 独立して実行可能か
- 明確な完了条件があるか
- コンテキスト依存が低いか

### 2. タスク情報を準備

以下の情報を整理：

- **タスクの説明**: 何をしてほしいか明確に
- **対象ファイル**: 変更・作成が必要なファイル
- **完了条件**: どうなれば完了か

### 3. 委任を実行

```bash
// turbo
python .agent/skills/jules-delegation/scripts/delegate.py "タスクの説明" --files file1.py file2.py
```

### 4. 結果を確認

委任が完了したら、ステータスを確認：

```bash
// turbo
python .agent/skills/jules-delegation/scripts/status.py --check
```

### 5. 結果をレビュー

Julesからの結果を確認し、必要に応じて修正・統合を行う。

---

## 委任例

### テスト作成を委任

```bash
python .agent/skills/jules-delegation/scripts/delegate.py "user_service.py のユニットテストを作成してください。正常系と異常系の両方をカバーしてください。" --files src/user_service.py tests/test_user_service.py
```

### ドキュメント更新を委任

```bash
python .agent/skills/jules-delegation/scripts/delegate.py "README.md にインストール手順と使い方を追加してください。" --files README.md
```

### リファクタリングを委任

```bash
python .agent/skills/jules-delegation/scripts/delegate.py "utils.py の重複コードを関数に抽出してリファクタリングしてください。" --files src/utils.py
```
