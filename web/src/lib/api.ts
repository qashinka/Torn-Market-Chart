const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface Item {
  id: number;
  name: string;
  type?: string;
  circulation: number;
  is_tracked: boolean;
  last_market_price: number;
  last_bazaar_price: number;
  last_updated_at: string;
  is_watched?: boolean;
  alert_price_above?: number | null;
  alert_price_below?: number | null;
  alert_change_percent?: number | null;
}

export interface PriceCandle {
  time: string;
  item_id: number;
  open: number;
  high: number;
  low: number;
  close: number;
  avg_price: number;
  volume: number;
}

export interface Listing {
  player_id: number;
  player_name: string;
  price: number;
  quantity: number;
  url: string;
}

export interface WebhookResponse {
  status: string;
  processed: number;
  total: number;
}

export interface Setting {
  key: string;
  value: string;
  description: string;
  is_secret: boolean;
  updated_at: string;
}

export interface User {
  id: number;
  name: string;
  created_at: string;
  last_login_at: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor() {
    this.baseUrl = API_BASE;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options?.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Pass token explicitly if provided in options (for server-side or initial fetch)
    // @ts-ignore
    if (options?.token) {
      // @ts-ignore
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Unauthorized');
      }
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Auth
  async login(apiKey: string): Promise<LoginResponse> {
    return this.request<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey }),
    });
  }

  async getMe(token?: string): Promise<User> {
    const options: any = {};
    if (token) options.token = token;
    return this.request<User>('/api/v1/auth/me', options);
  }

  // Items
  async getTrackedItems(): Promise<Item[]> {
    return this.request<Item[]>('/api/v1/items');
  }

  async searchItems(query: string): Promise<Item[]> {
    return this.request<Item[]>(`/api/v1/items/search?q=${encodeURIComponent(query)}`);
  }

  async getWatchedItems(): Promise<Item[]> {
    return this.request<Item[]>('/api/v1/items/watched');
  }

  async getItem(id: number): Promise<Item> {
    return this.request<Item>(`/api/v1/items/${id}/latest`);
  }

  async toggleWatchlist(id: number): Promise<{ item_id: number; is_watched: boolean }> {
    return this.request<{ item_id: number; is_watched: boolean }>(`/api/v1/items/${id}/watch`, {
      method: 'POST',
    });
  }

  // Price History
  async getPriceHistory(
    itemId: number,
    options?: { interval?: string; days?: number; type?: 'market' | 'bazaar' }
  ): Promise<PriceCandle[]> {
    const params = new URLSearchParams();
    if (options?.interval) params.set('interval', options.interval);
    if (options?.days) params.set('days', options.days.toString());
    if (options?.type) params.set('type', options.type);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<PriceCandle[]>(`/api/v1/items/${itemId}/history${query}`);
  }

  // Webhook (for testing)
  async sendWebhookUpdate(items: {
    torn_id: number;
    price: number;
    type: 'market' | 'bazaar';
    seller_id?: number;
    listing_id?: number;
  }[]): Promise<WebhookResponse> {
    return this.request<WebhookResponse>('/api/webhook/update', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  // External prices (TornExchange, Weav3r)
  async getExternalPrices(itemId: number): Promise<Record<string, number>> {
    return this.request<Record<string, number>>(`/api/v1/items/${itemId}/external-prices`);
  }

  // Top Listings
  async getTopListings(itemId: number, type: 'market' | 'bazaar'): Promise<Listing[]> {
    return this.request<Listing[]>(`/api/v1/items/${itemId}/listings?type=${type}`);
  }

  // Alert Settings
  async updateAlertSettings(itemId: number, settings: {
    alert_price_above?: number | null;
    alert_price_below?: number | null;
    alert_change_percent?: number | null;
  }): Promise<void> {
    return this.request<void>(`/api/v1/items/${itemId}/alerts`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Settings
  async getSettings(): Promise<Setting[]> {
    return this.request<Setting[]>('/api/v1/settings');
  }

  async updateSetting(setting: Partial<Setting>): Promise<void> {
    return this.request<void>('/api/v1/settings', {
      method: 'PUT',
      body: JSON.stringify(setting),
    });
  }

  // User Settings
  async getUserSettings(): Promise<Record<string, string>> {
    return this.request<Record<string, string>>('/api/v1/user/settings');
  }

  async updateUserSetting(key: string, value: string): Promise<void> {
    return this.request<void>('/api/v1/user/settings', {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    });
  }
}

export const api = new ApiClient();
