# プロジェクト仕様書: Torn Market Chart

## 1. 概要
**Torn Market Chart** は、MMORPG「Torn City」のアイテム価格を追跡・可視化するためのWebツールです。TradingViewスタイルのチャート、リアルタイムのオーダーブック（マーケットとバザールの最安トップ5）、および信頼性向上のためのマルチAPIキー管理機能を提供します。

## 2. 技術スタック

### Backend
*   **言語:** Python 3.10+
*   **フレームワーク:** FastAPI
*   **データベース:** MySQL 8.0 (`asyncmy` + SQLAlchemy による非同期アクセス)
*   **キャッシュ/キュー:** Redis (レート制限およびキーローテーション用)
*   **スケジューラ:** APScheduler (バックグラウンドでの価格取得)
*   **外部リクエスト:** `curl_cffi` (Cloudflare回避のためのバザールスクレイピング)

### Frontend
*   **フレームワーク:** React 18 (Vite)
*   **スタイリング:** TailwindCSS
*   **状態管理/クエリ:** TanStack Query
*   **チャート:** lightweight-charts (TradingViewライブラリ)
*   **HTTPクライアント:** Axios

### Infrastructure
*   **コンテナ化:** Docker & Docker Compose
*   **プロファイル:**
    *   `internal`: MySQLを統合したコンパクトなローカルセットアップ。
    *   `external`: Tailscaleサイドカーを経由してリモートMySQLに接続。
*   **管理:** DB確認用のPHPMyAdminを同梱。

## 3. データアーキテクチャ

### コアモデル (`backend/app/models/models.py`)

#### `Item`
*   **目的:** 追跡対象アイテムのレジストリ。
*   **主要フィールド:** `torn_id`, `name`, `is_tracked`, `last_market_price`, `last_bazaar_price`.
*   **キャッシング:** `orderbook_snapshot` (JSON) に最新のトップ5出品情報を保存。

#### `PriceLog`
*   **目的:** 過去の価格データポイント。
*   **主要フィールド:** `item_id`, `timestamp`, `market_price`, `bazaar_price`, 平均値。
*   **インデックス:** `(item_id, timestamp)` の複合インデックス。

#### `ApiKey`
*   **目的:** Torn APIキーの管理。
*   **主要フィールド:** `key`, `is_active`, `last_used_at`.
*   **ロジック:** 負荷分散のためのラウンドロビンローテーション。

#### `PriceAlert` (計画中/部分的)
*   **目的:** 価格閾値に対するユーザー定義アラート。
*   **フィールド:** `target_price`, `condition` (above/below).

## 4. 主要機能
1.  **高度なチャート機能:** 最安値、平均値、24時間移動平均トレンドを可視化。
2.  **オーダーブック:** 公式アイテムマーケットとユーザーバザールの両方から、最安5件の出品をライブ表示。
3.  **スマート取得:**
    *   並列APIリクエスト (セマフォ制限: 5)。
    *   失敗したアイテムに対するバックオフ戦略。
    *   DBにキーがない場合の環境変数キーへのフォールバック。
4.  **デプロイモード:** Docker Composeプロファイルを使用して、ローカルDBとリモートDB構成をシームレスに切り替え。

## 5. セキュリティ & ネットワーク
*   **Tailscale統合:** ポートを公開せずにリモートデータベースにアクセスするためのセキュアなプライベートネットワーク。
*   **プロキシヘッダー:** 正しいIP解決のためにプロキシヘッダーを信頼するようにFastAPIを構成。
