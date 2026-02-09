'use client';

import { useEffect, useState } from 'react';
import { api, Item } from '@/lib/api';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';

export function WatchlistPanel({ currentItemId }: { currentItemId: number }) {
    const { isAuthenticated } = useAuth();
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthenticated) {
            setLoading(false);
            return;
        }

        const fetchWatchlist = async () => {
            setLoading(true);
            try {
                const data = await api.getWatchedItems();
                setItems(data);
            } catch (error) {
                console.error('Failed to fetch watchlist:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchWatchlist();
    }, [isAuthenticated]);

    if (!isAuthenticated) {
        return (
            <div className="p-8 text-center text-gray-500 text-sm">
                <p>Please log in to view your watchlist.</p>
                <Link href="/settings" className="text-[#2962FF] hover:underline text-xs mt-2 block">
                    Go to Settings
                </Link>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="p-8 text-center">
                <div className="animate-spin w-6 h-6 border-2 border-[#2962FF] border-t-transparent rounded-full mx-auto mb-2" />
                <p className="text-xs text-gray-500">Loading watchlist...</p>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="p-8 text-center text-gray-500 text-sm">
                <p>No items in watchlist.</p>
                <Link href="/dashboard" className="text-[#2962FF] hover:underline text-xs mt-2 block">
                    Go to Dashboard to add items
                </Link>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#131722]">
            <div className="flex-1 overflow-y-auto">
                {items.map((item) => (
                    <Link
                        key={item.id}
                        href={`/items/${item.id}`}
                        className={`block p-3 border-b border-[#2B2B43] hover:bg-[#2a2e39] transition-colors ${item.id === currentItemId ? 'bg-[#2a2e39] border-l-2 border-l-[#2962FF]' : 'border-l-2 border-l-transparent'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-1">
                            <span className={`font-medium truncate text-sm ${item.id === currentItemId ? 'text-[#2962FF]' : 'text-[#e1e1e1]'}`}>
                                {item.name}
                            </span>
                            <span className="text-[10px] text-gray-500 bg-[#1e222d] px-1 rounded">#{item.id}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-400">Market Price</span>
                            <span className="text-sm font-bold text-[#e1e1e1]">
                                ${item.last_market_price.toLocaleString()}
                            </span>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
