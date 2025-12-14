import requests
import cloudscraper
from typing import List, Optional, Union, Dict

TORN_API_KEY = "TORN_API_KEY"

class Listing:
    """個々の出品情報を表すクラス"""

    def __init__(
        self,
        price: int,
        quantity: int,
        item_id: int = 0,
        player_id: int = 0,
        player_name: str = "Market",
        source: str = "Unknown",
        content_updated: int = 0,
        last_checked: int = 0,
        content_updated_relative: str = "",
        last_checked_relative: str = ""
    ):
        self.item_id: int = int(item_id) if item_id is not None else 0
        self.player_id: int = int(player_id) if player_id is not None else 0
        self.player_name: str = str(player_name) if player_name is not None else "Market"
        self.quantity: int = int(quantity)
        self.price: int = int(price)
        self.source: str = source  # "Bazaar" or "ItemMarket"

        self.content_updated: int = int(content_updated) if content_updated is not None else 0
        self.last_checked: int = int(last_checked) if last_checked is not None else 0
        self.content_updated_relative: str = str(content_updated_relative) if content_updated_relative is not None else ""
        self.last_checked_relative: str = str(last_checked_relative) if last_checked_relative is not None else ""

    @classmethod
    def from_bazaar_dict(cls, data: dict[str, Union[str, int]]) -> 'Listing':
        """Bazaar API (weav3r.dev) の辞書データからListingインスタンスを作成"""
        return cls(
            price=data.get("price"),
            quantity=data.get("quantity"),
            item_id=data.get("item_id"),
            player_id=data.get("player_id"),
            player_name=data.get("player_name"),
            source="Bazaar",
            content_updated=data.get("content_updated"),
            last_checked=data.get("last_checked"),
            content_updated_relative=data.get("content_updated_relative"),
            last_checked_relative=data.get("last_checked_relative")
        )

    @classmethod
    def from_item_market_dict(cls, data: dict[str, Union[str, int]], item_id: int) -> 'Listing':
        """Torn API (Item Market) の辞書データからListingインスタンスを作成"""
        return cls(
            price=data.get("price"),
            quantity=data.get("amount"), # APIのフィールド名は amount
            item_id=item_id,
            player_id=0,       # Item Marketでは個別の出品者IDは取得できない場合が多い
            player_name="Item Market",
            source="ItemMarket"
        )

class MarketResponse:
    """Bazaar APIレスポンス全体を表すクラス"""

    def __init__(
        self,
        item_id: int,
        item_name: str,
        market_price: int,
        bazaar_average: int,
        total_listings: int,
        listings: Union[List[dict], List[Listing]]
    ):
        self.item_id: int = int(item_id)
        self.item_name: str = str(item_name)
        self.market_price: int = int(market_price)
        self.bazaar_average: int = int(bazaar_average)
        self.total_listings: int = int(total_listings)

        self.listings: List[Listing] = []
        if isinstance(listings, list):
            for x in listings:
                if isinstance(x, Listing):
                    self.listings.append(x)
                elif isinstance(x, dict):
                    self.listings.append(Listing.from_bazaar_dict(x))

    @classmethod
    def from_dict(cls, data: dict[str, Union[str, int]]) -> 'MarketResponse':
        """辞書データからMarketResponseインスタンスを作成する"""
        listings_data = data.get("listings", [])

        return cls(
            item_id=data.get("item_id"),
            item_name=data.get("item_name"),
            market_price=data.get("market_price"),
            bazaar_average=data.get("bazaar_average"),
            total_listings=data.get("total_listings"),
            listings=listings_data
        )

def fetch_bazaar_data(item_id: int) -> Optional[MarketResponse]:
    """
    既存関数: Bazaarデータを取得 (weav3r.dev)
    """
    url = f"https://weav3r.dev/api/marketplace/{item_id}"
    
    headers = {
        'Host': 'weav3r.dev',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
    }

    # Ensure the scraper session is closed after use
    with cloudscraper.create_scraper() as scraper:
        try:
            response = scraper.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()
            return MarketResponse.from_dict(data)
        except Exception as e:
            print(f"[Bazaar] エラー発生: {e}")
            return None

def fetch_item_market_data(item_id: int, api_key: str) -> List[Listing]:
    """
    新規関数: Item Marketデータを取得 (api.torn.com v2)
    """
    if not api_key or api_key == "TORN_API_KEY":
        print("[Item Market] APIキーが設定されていないため、スキップします。")
        return []

    url = f"https://api.torn.com/v2/market/{item_id}/itemmarket?limit=30&offset=0"

    headers = {
        'accept': 'application/json',
        'Authorization': f'ApiKey {api_key}'
    }

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()

        listings_data = data.get("itemmarket", {}).get("listings", [])

        # 辞書リストをListingオブジェクトのリストに変換
        return [Listing.from_item_market_dict(item, item_id) for item in listings_data]

    except Exception as e:
        print(f"[Item Market] エラー発生: {e}")
        return []

def fetch_all_items(api_key: str) -> Dict[int, str]:
    """Torn APIから全アイテムを取得し、ID:名前の辞書を返す"""
    if not api_key or api_key == "TORN_API_KEY":
        print("[Items] APIキーが設定されていないため、全アイテム取得をスキップします。")
        return {}

    url = f"https://api.torn.com/torn/?selections=items&key={api_key}"

    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()

        if "error" in data:
            print(f"[Items] APIエラー: {data['error']}")
            return {}

        items_data = data.get("items", {})
        result = {}
        for item_id, info in items_data.items():
            result[int(item_id)] = info.get("name", "Unknown")

        return result
    except Exception as e:
        print(f"[Items] 全アイテム取得中にエラー: {e}")
        return {}

def print_merged_listings(listings: List[Listing], item_name: str, count: int = 20) -> None:
    """統合された出品情報を表示する"""
    print(f"\n=== {item_name} の統合出品情報 (価格順) ===")
    print(f"{'ソース':<12} {'価格':<10} {'数量':<10} {'プレイヤー名':<20} {'更新/詳細'}")
    print("-" * 80)

    for listing in listings[:count]:
        time_info = listing.content_updated_relative if listing.content_updated_relative else "-"
        print(f"{listing.source:<12} {listing.price:<10} {listing.quantity:<10} {listing.player_name:<20} {time_info}")
    print("-" * 80)

def main() -> None:
    # アイテムID 196 (Cannabis)
    target_item_id: int = 196

    # 1. Bazaar情報の取得
    bazaar_data = fetch_bazaar_data(target_item_id)
    bazaar_listings = bazaar_data.listings if bazaar_data else []
    item_name = bazaar_data.item_name if bazaar_data else f"Item {target_item_id}"

    # 2. Item Market情報の取得
    market_listings = fetch_item_market_data(target_item_id, TORN_API_KEY)

    # 3. リストの統合
    all_listings = bazaar_listings + market_listings

    if not all_listings:
        print("出品情報が見つかりませんでした。")
        return

    # 4. 価格順にソート (安い順)
    all_listings.sort(key=lambda x: x.price)

    # 5. 結果の表示
    print_merged_listings(all_listings, item_name, count=20)

    # 最安値情報の表示
    cheapest = all_listings[0]
    print(f"\n最安値: ${cheapest.price} (ソース: {cheapest.source}, 数量: {cheapest.quantity})")

if __name__ == "__main__":
    main()
