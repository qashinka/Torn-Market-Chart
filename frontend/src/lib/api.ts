import axios from 'axios';

// Create api client
// In dev, usage of proxy in vite.config.ts is better, but hardcoding for now if needed.
// However, docker-compose exposes api on 8000, web on 3000.
// We should use relative path /api and proxy in vite or nginx.
export const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api/v1',
    headers: {
        'Content-Type': 'application/json',
    },
});

api.interceptors.request.use((config) => {
    const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD || 'secretadmin';
    if (adminPassword) {
        config.headers['x-admin-password'] = adminPassword;
    }
    return config;
});

export interface ApiKey {
    id: number;
    key: string;
    comment?: string;
    is_active: boolean;
    last_used_at?: string;
}

export const getApiKeys = async () => {
    const response = await api.get<ApiKey[]>('/settings/apikeys');
    return response.data;
};

export const createApiKey = async (key: string, comment?: string) => {
    const response = await api.post<ApiKey>('/settings/apikeys', { key, comment });
    return response.data;
};

export const deleteApiKey = async (id: number) => {
    await api.delete(`/settings/apikeys/${id}`);
};

// System Config
export const getSystemConfig = async () => {
    const response = await api.get<Record<string, string>>('/settings/config');
    return response.data;
};

export const updateSystemConfig = async (config: Record<string, string>) => {
    await api.post('/settings/config', config);
};

export interface Item {
    id: number;
    torn_id: number;
    name: string;
    description?: string;
    type?: string;
    is_tracked?: boolean;
    last_market_price?: number;
    last_bazaar_price?: number;
    last_market_price_avg?: number;
    last_bazaar_price_avg?: number;
    last_updated_at?: string;
}

export const getItems = async () => {
    const response = await api.get<Item[]>('/items');
    return response.data;
};

export const createItem = async (torn_id: number, name: string) => {
    const response = await api.post<Item>('/items', { torn_id, name });
    return response.data;
};

export const deleteItem = async (id: number) => {
    await api.delete(`/items/${id}`);
};

export interface TornItem {
    name: string;
    type: string;
    description: string;
    // ... other fields
}

export const getTornItems = async () => {
    const response = await api.get<Item[]>('/items/torn');
    return response.data;
};

export interface PricePoint {
    timestamp: string;
    market_price: number;
    bazaar_price: number;
    market_price_avg?: number;
    bazaar_price_avg?: number;
}

export const getHistory = async (itemId: number) => {
    const response = await api.get<PricePoint[]>(`/items/${itemId}/history`);
    // Backend returns newest first (DESC), but charts usually expect oldest first (Left->Right)
    // or we just want standard time flow Left(Old) -> Right(New).
    return response.data.reverse();
};

// Order Book / Listings
export interface Listing {
    price: number;
    quantity: number;
    type: 'market' | 'bazaar';
    id?: number | string;
}

export interface OrderBookResponse {
    market_price: number;
    bazaar_price: number;
    market_price_avg: number;
    bazaar_price_avg: number;
    listings: {
        market: Listing[];
        bazaar: Listing[];
    };
    status: {
        market: boolean;
        bazaar: boolean;
    };
}

export const getOrderBook = async (itemId: number) => {
    const response = await api.get<OrderBookResponse>(`/items/${itemId}/orderbook`);
    return response.data;
};

export interface Alert {
    id: number;
    item_id: number;
    target_price: number;
    condition: 'above' | 'below';
    is_active: boolean;
    is_persistent: boolean;
}

export const getAlerts = async (itemId: number) => {
    const response = await api.get<Alert[]>(`/alerts/item/${itemId}`);
    return response.data;
};

export const createAlert = async (itemId: number, target_price: number, condition: string, is_persistent: boolean = false) => {
    const response = await api.post<Alert>('/alerts/', { item_id: itemId, target_price, condition, is_persistent });
    return response.data;
};

export const deleteAlert = async (id: number) => {
    await api.delete(`/alerts/${id}`);
};
