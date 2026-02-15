# Cloudflare Tunnel を使用したデプロイガイド

このガイドでは、Cloudflare Tunnel を使用して、自宅サーバーやVPS上の Torn Market Chart アプリケーションを安全にインターネットに公開する方法を説明します。ポート開放（ポートフォワーディング）は不要です。

## 前提条件

1.  **ドメイン**: Cloudflare で管理されているドメインが必要です。
2.  **Cloudflare アカウント**: 無料プランで問題ありません。
3.  **サーバー**: Docker と Docker Compose がインストールされていること（Windows, Linux, Mac いずれでも可）。

## 手順

### 1. Cloudflare Zero Trust で Tunnel を作成する

1.  [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) にアクセスします。
2.  左メニューの **Networks** > **Tunnels** をクリックします。
3.  **Create a tunnel** をクリックします。
4.  **Connector** は **Cloudflared** を選択して **Next** をクリックします。
5.  **Tunnel name** に適当な名前（例: `torn-market-server`）を入力し、**Save tunnel** をクリックします。
6.  **Install and run a connector** の画面が表示されますが、ここに表示される **Token** だけが必要です。
    - 画面下のコマンド例の中に、`--token` の後に続く長い文字列があります。これが `TUNNEL_TOKEN` です。このトークンをコピーしてください。

### 2. 環境変数の設定

プロジェクトのルートディレクトリにある `.env` ファイルを開き（なければ作成し）、以下の内容を追加・編集します。

```dotenv
# Cloudflare Tunnel Token (手順1で取得したもの)
TUNNEL_TOKEN=eyJhIjoi... (あなたのトークン)

# 公開するAPIのURL
# Cloudflare Tunnelで api.your-domain.com のようなサブドメインをAPI用に割り当てる場合
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

### 3. Public Hostname の設定

Cloudflare Zero Trust Dashboard のトンネル設定画面に戻り、**Next** をクリックして **Public Hostname** タブに進みます。

アプリケーションを正しく動作させるために、2つのホスト名（サブドメイン）を設定することを推奨します。1つはWebフロントエンド用、もう1つはAPI用です。

#### Webフロントエンド用 (例: `torn-market.your-domain.com`)
- **Subdomain**: `torn-market` (お好みのもの)
- **Domain**: `your-domain.com` (あなたのドメイン)
- **Service**:
    - **Type**: `HTTP`
    - **URL**: `frontend:3000`

#### API用 (例: `api.your-domain.com`)
- **Subdomain**: `api` (お好みのもの)
- **Domain**: `your-domain.com` (あなたのドメイン)
- **Service**:
    - **Type**: `HTTP`
    - **URL**: `api:8080`

設定したら **Save tunnel** をクリックします。

### 4. アプリケーションの起動

以下のコマンドでアプリケーションとTunnelを起動します。

```bash
docker compose --profile external up -d
```
※ `--profile external` は、外部公開用の設定（Tunnelなど）を含むプロファイルを有効にするためのものです。

### 5. 動作確認

設定した Webフロントエンド用のURL（例: `https://torn-market.your-domain.com`）にブラウザでアクセスしてください。
正常に表示されれば設定完了です。

### トラブルシューティング

- **Tunnelサービスが起動しない**: `.env` ファイルに `TUNNEL_TOKEN` が正しく設定されているか確認してください。
- **502 Bad Gateway**: `frontend` や `api` コンテナがまだ起動していない可能性があります。数秒待ってから再試行してください。また、Tunnel設定の Service URL が正しいか（`frontend:3000`, `api:8080`）を確認してください。
- **APIエラー**: ブラウザの開発者ツール(F12)のネットワークタブを確認し、APIリクエストが正しいURL（例: `https://api.your-domain.com`）に送られているか確認してください。`.env` の `NEXT_PUBLIC_API_URL` 設定が反映されているか確認してください（変更後は `docker compose up -d` で再作成が必要です）。
