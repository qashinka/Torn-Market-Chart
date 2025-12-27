---
description: データベースのスキーマ変更を行い、マイグレーションを適用する手順
---
データベースに変更を加える際は、必ず以下の手順に従ってください。
基本的にはDocker環境内での実行を想定しています。

## 1. モデルの変更
- `backend/app/models/models.py` を編集し、必要なカラムやテーブルを追加/変更します。

## 2. マイグレーションファイルの生成
- 以下のコマンドで自動生成します（Dockerコンテナ内で実行）。
  ```bash
  docker-compose exec api alembic revision --autogenerate -m "describe_your_change_here"
  ```
- **重要**: 生成された `backend/alembic/versions/` 下のファイルを必ず開き、意図通りの変更になっているか確認してください。
  - `upgrade()` 関数と `downgrade()` 関数が正しく生成されているかチェックする。

## 3. マイグレーションの適用
- 確認ができたら、以下のコマンドでDBに適用します。
  ```bash
  docker-compose exec api alembic upgrade head
  ```

## 4. 検証
- DBに変更が反映されたことを確認します (PHPMyAdminなどを使用)。
- アプリケーションがエラーなく起動し、該当データにアクセスできるか確認します。
