# Torn Market Chart

Torn City マーケットトラッカー & 可視化ツール。TradingView スタイルのチャートとリアルタイムのオーダーブック（板情報）機能を備えています。

## 機能

### 📊 高度なチャート機能
- **TradingView スタイルのチャート**: `lightweight-charts` を使用したエリアチャートとラインチャート
- **価格の可視化**: 最安値、平均値（上位5件）、24時間移動平均トレンドを表示
- **インタラクティブな凡例**: すべての価格指標を表示するリアルタイムのクロスヘア（十字カーソル）ツールチップ
- **自動スケーリング**: アイテム切り替え時にチャートのスケールを自動調整
- **データ品質**: 無効なデータ（ゼロやnull値）を除外し、クリーンな可視化を実現

### 📈 オーダーブック（板情報）統合
- **リアルタイム上位5件リスト**: アイテムマーケットとバザールの両方から、最安値の上位5件を表示
- **DBキャッシュ**: データベースのキャッシュから即座に表示（バックグラウンドワーカーが毎分更新）
- **ダイレクトリンク**: リストをクリックするだけで、アイテムマーケットや出品者のバザールへ直接移動
- **デュアルソース**: Torn公式API（マーケット）と weav3r.dev（バザール）からデータを取得

### 🔑 複数APIキー管理
- **キーローテーション**: 設定されたAPIキーをラウンドロビン方式で順次使用
- **動的レート制限**: アクティブなキーの数に基づいてリクエスト数を自動的にスケーリング
- **キーごとの追跡**: 各キーの最終使用時間とステータスを監視
- **フォールバックサポート**: DBにキーが設定されていない場合、環境変数をフォールバックとして使用

### ⚙️ スマートな価格更新
- **並行取得**: セマフォ制御による並行APIリクエスト（制限: 5同時リクエスト）
- **エラー耐性**: 取得失敗が他のアイテムをブロックすることはなく、タイムスタンプ付きで記録されます
- **バックオフ戦略**: 継続的に失敗するアイテムの取得頻度を低減
- **リストのスナップショット**: 上位5件のマーケット/バザールリストをDBに保存し、即時アクセスを実現

## セットアップ

1. `.env.example` を `.env` にコピーして設定します:
   ```env
   DB_ROOT_PASSWORD=your_root_password
   DB_NAME=torn_market
   DB_USER=torn_market
   DB_PASSWORD=your_db_password
   DB_HOST=db # または外部DBのIPアドレス
   DB_PORT=3306
   ADMIN_PASSWORD=your_admin_password
   TORN_API_KEY=optional_fallback_key
   # 内部DBを使用する場合は下記を設定。外部DBを使用する場合は空にするかコメントアウト。
   COMPOSE_PROFILES=internal-db
   ```

   **外部データベースを使用する場合:**
   Dockerコンテナのデータベースではなく、独自のデータベースサーバーを使用するには：
   1. `DB_HOST` にデータベースサーバーのIPアドレスを設定します（例: `192.168.1.100` や `host.docker.internal`）。
   2. `COMPOSE_PROFILES` を空にするか、行を削除します。これにより内部のMySQLコンテナが起動しなくなります。

   2. `DB_PORT` にデータベースのポートを設定します（デフォルト: 3306）。
   3. `DB_USER` と `DB_PASSWORD` が外部データベースの認証情報と一致していることを確認してください。

2. アプリケーションを起動します:
   ```bash
   docker-compose up -d --build
   ```

3. ダッシュボードにアクセスします: `http://localhost:3000`

4. APIキーの設定:
   - **Settings**（設定）ページに移動します
   - 1つ以上の Torn APIキーを追加します
   - 価格取得時にキーが自動的にローテーションされます

5. アイテムの追跡:
   - **Manage Items**（アイテム管理）に移動します
   - Tornのカタログからアイテムを検索します
   - **Track**（追跡）をクリックしてダッシュボードに追加します

## 技術スタック

### バックエンド
- **FastAPI**: 非同期サポートを備えたモダンなPython Webフレームワーク
- **SQLAlchemy**: 非同期MySQL/MariaDBサポート (`asyncmy`) を備えたORM
- **APScheduler**: 定期的な価格更新のためのバックグラウンドジョブスケジューリング
- **Redis**: レート制限とAPIキーローテーション管理
- **curl_cffi**: Cloudflareを回避してバザール情報を取得するためのHTTPクライアント

### フロントエンド
- **React 18**: フックを備えたモダンなUIライブラリ
- **Vite**: 高速な開発・ビルドツール
- **lightweight-charts**: TradingView品質のチャートライブラリ
- **TanStack Query**: データ取得とキャッシング
- **Axios**: API通信用HTTPクライアント
- **TailwindCSS**: ユーティリティファーストなCSSフレームワーク

### データベース
- **MySQL 8.0**: アイテム、価格、メタデータのための主要データストア
- **Redis**: レート制限とキーローテーションのためのインメモリキャッシュ

### インフラストラクチャ
- **Docker & Docker Compose**: コンテナ化されたデプロイ環境
- **Nginx**: フロントエンド静的ファイルのリバースプロキシ（本番環境用）
- **PHPMyAdmin**: データベース管理インターフェース (`http://localhost:8081`)

## アーキテクチャ

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Frontend   │────▶│   FastAPI    │────▶│   MySQL     │
│  (React)    │     │   Backend    │     │  Database   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │                      
                           ▼                      
                    ┌──────────────┐              
                    │    Redis     │              
                    │  (Caching)   │              
                    └──────────────┘              
                           │                      
                           ▼                      
                    ┌──────────────┐              
                    │   Worker     │              
                    │ (APScheduler)│              
                    └──────────────┘              
                           │                      
                ┌──────────┴──────────┐           
                ▼                     ▼           
         ┌─────────────┐       ┌─────────────┐   
         │  Torn API   │       │ weav3r.dev  │   
         │  (Market)   │       │  (Bazaar)   │   
         └─────────────┘       └─────────────┘   
```

## 開発

### ローカル開発
```bash
# バックエンド (ホットリロード有効)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# フロントエンド (HMR有効)
cd frontend
npm install
npm run dev
```

### データベース移行
新しいカラムを追加する場合:
1. `backend/app/models/models.py` を更新します
2. `http://localhost:8081` で PHPMyAdmin にアクセスします
3. SQLタブで `ALTER TABLE` ステートメントを実行します

## API エンドポイント

- `GET /api/v1/items` - 追跡中のアイテム一覧
- `GET /api/v1/items/torn` - Tornカタログアイテムの取得
- `POST /api/v1/items` - アイテムの追跡を追加
- `DELETE /api/v1/items/{id}` - アイテムの追跡を停止
- `GET /api/v1/items/{id}/history` - 価格履歴の取得
- `GET /api/v1/items/{id}/orderbook` - リアルタイムオーダーブック（上位5件）の取得
- `GET /api/v1/settings/apikeys` - APIキー一覧
- `POST /api/v1/settings/apikeys` - APIキーの追加
- `DELETE /api/v1/settings/apikeys/{id}` - APIキーの削除

## ライセンス

MIT
