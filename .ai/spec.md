# 現行システム仕様書 (Torn Market Chart)

## 1. システム概要
Torn Cityのアイテム価格を追跡・可視化し、設定した条件に基づいてDiscord通知を行うツール。
公式API（Item Market）と外部サービス（weav3r.dev, Bazaar）の双方からデータを取得し、TradingViewスタイルのチャートで表示する。
バックエンドにGo、フロントエンドにNext.jsを採用し、高パフォーマンスとリアルタイム性を重視した設計となっている。

## 2. アーキテクチャ構成

### バックエンド
- **言語**: Go (Golang) 1.22+
- **WAF**: 標準ライブラリ (`net/http`) + `Chi` (Routing)
- **データベース接続**: `pgx/v5` Pool
- **並行処理**: Goroutines / Channels / `errgroup`
- **リアルタイム通信**: `Gorilla WebSocket` (Official API接続)

### フロントエンド
- **フレームワーク**: Next.js 14 (App Router)
- **UIライブラリ**: ShadcnUI, TailwindCSS
- **チャート**: `lightweight-charts`
- **データ取得**: SWR / server actions

### インフラ・データ
- **データベース**: PostgreSQL 16 + TimescaleDB (時系列データ最適化)
- **キャッシュ/KVS**: Redis (レート制限、APIキー管理)
- **デプロイ**: Docker Compose (Profile: internal/external)

## 3. データモデル (Database Schema)

### `items` (アイテム管理)
- **基本情報**: `id` (Torn ID), `name`, `description`, `type`, `circulation`, `market_value`
- **管理フラグ**: `is_watched` (監視対象), `last_updated_at`
- **最新キャッシュ**: `last_market_price`, `last_bazaar_price`

### `market_prices` / `bazaar_prices` (Hypertable)
- **時系列データ**: `time`, `item_id`, `price`, `quantity`, `listing_id` (Market) / `seller_id` (Bazaar)
- **TimescaleDB機能**: 自動パーティショニング、圧縮、連続集計（予定）

### `alerts` (通知設定)
- **条件**: `item_id`, `target_price`, `condition` (above/below)
- **設定**: `is_active`, `is_persistent` (繰り返し通知)
- **状態**: `last_triggered_at`

### `api_keys` (APIキー管理)
- **情報**: `key`, `comment`, `is_active`, `error_count`

## 4. コアロジック・ワーカー仕様 (`cmd/workers`)

### 4.1. BazaarPoller (監視アイテム更新)
- **役割**: 監視リスト (`is_watched=true`) にあるアイテムの価格を `weav3r.dev` から取得。
- **頻度**: デフォルト **10秒ごと**。
- **並行数**: `MAX_CONCURRENT_FETCHES` (デフォルト5) で制限。
- **レート制限**: Redisを使用した `1800 req/min` 制限 (Weav3r API用)。

### 4.2. BackgroundCrawler (全アイテム巡回)
- **役割**: 全アイテムの価格履歴を埋めるため、監視対象外のアイテムも含めて巡回。
- **ロジック**: `last_updated_at` が最も古いアイテムを選択して取得 (Torn Official API v2)。
- **頻度**: デフォルト **500msごと** (120 req/min)。

### 4.3. GlobalSync (カタログ同期)
- **役割**: Tornの全アイテム定義（ID, 名前）を取得し、dbを更新。
- **頻度**: **24時間に1回**。

### 4.4. TornWebSocketService (リアルタイム通知)
- **役割**: TornのWebSocketサーバー (`wss://ws-centrifugo.torn.com`) に接続し、トレード情報をリアルタイム受信。
- **機能**:
  - `item-market` チャンネルを購読。
  - 受信した価格がアラート条件を満たした場合、即座にDiscord通知を送信。

## 5. その他機能
- **APIキーローテーション**: `Worker` が使用するAPIキーをラウンドロビンで切り替え。
- **Discord通知**: Webhookを使用し、価格変動時にEmbedメッセージを送信。
