# Torn Market Tracker

Torn Cityのアイテム価格を追跡・可視化するWebアプリケーションです。バザールとアイテムマーケットの両方を監視します。

## 機能

- **価格追跡**: 1分ごとにアイテム価格を自動的に取得します。
- **デュアルソース監視**: `バザール`と`アイテムマーケット`の価格を個別に追跡します。
- **インタラクティブなチャート**:
    - 選択可能な時間枠（1分から1日）。
    - ラインチャートとローソク足チャートの切り替え。
    - 最小価格/平均価格の表示カスタマイズ。
- **Docker化**: Docker Composeを使用して簡単にデプロイできます。
- **データベースサポート**: MySQL 8.0（Docker環境）およびSQLiteをサポートします。

## 技術スタック

- **バックエンド**: Python (FastAPI), SQLAlchemy, APScheduler, Cloudscraper
- **フロントエンド**: HTML5, Vanilla JS, TradingView Lightweight Charts
- **データベース**: MySQL 8.0 (または SQLite)
- **コンテナ化**: Docker, Docker Compose

## セットアップと実行

1. **リポジトリのクローン:**
   ```bash
   git clone <repository-url>
   cd torn-market-tracker
   ```

2. **Docker Composeで開始:**
   ```bash
   docker-compose up --build -d
   ```

3. **アプリケーションへのアクセス:**
   ブラウザを開き、`http://localhost:5000`にアクセスします。

4. **設定:**
   - UIの「Settings」をクリックします。
   - **Torn API Key**を追加します。
   - 追跡するアイテムをIDで追加します（例：XanaxのIDは`206`です）。

## 開発

- バックエンドのエントリーポイントは `app/main.py` です。
- フロントエンドは `app/index.html` と `app/static/` にあります。
- バックグラウンドタスクは `app/main.py` 内の `APScheduler` によって処理されます。

## ライセンス

MIT
