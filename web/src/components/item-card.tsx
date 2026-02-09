'use client';

import { useState } from 'react';
import { api, Item } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';

interface ItemCardProps {
    item: Item;
}

export function ItemCard({ item }: ItemCardProps) {
    const { isAuthenticated } = useAuth();
    const router = useRouter();
    const [isWatched, setIsWatched] = useState(item.is_watched || false);
    const [isUpdating, setIsUpdating] = useState(false);

    const handleWatchToggle = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!isAuthenticated) {
            router.push('/settings');
            return;
        }

        if (isUpdating) return;

        const newState = !isWatched;
        setIsWatched(newState);
        setIsUpdating(true);

        try {
            await api.toggleWatchlist(item.id);
        } catch (error) {
            console.error('Failed to toggle watchlist:', error);
            setIsWatched(!newState); // Revert
        } finally {
            setIsUpdating(false);
        }
    };

    const formatPrice = (price: number) => {
        if (price >= 1_000_000_000) return `$${(price / 1_000_000_000).toFixed(2)}B`;
        if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(2)}M`;
        if (price >= 1_000) return `$${(price / 1_000).toFixed(1)}K`;
        return `$${price.toLocaleString()}`;
    };

    const marketPrice = item.last_market_price || 0;
    const bazaarPrice = item.last_bazaar_price || 0;
    const spread = marketPrice > 0 && bazaarPrice > 0
        ? ((marketPrice - bazaarPrice) / bazaarPrice * 100).toFixed(1)
        : null;

    return (
        <Link href={`/items/${item.id}`}>
            <div className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors cursor-pointer">
                <div className="flex justify-between items-start mb-2">
                    <div>
                        <h3 className="font-semibold text-card-foreground">{item.name}</h3>
                        <p className="text-xs text-muted-foreground">{item.type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleWatchToggle}
                            disabled={isUpdating}
                            className={`p-1 rounded-full hover:bg-secondary transition-colors ${isWatched ? 'text-yellow-400' : 'text-muted-foreground'}`}
                            title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
                        >
                            <Star className="w-5 h-5" fill={isWatched ? "currentColor" : "none"} />
                        </button>
                        <span className="text-xs bg-secondary px-2 py-0.5 rounded">
                            #{item.id}
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                    <div>
                        <p className="text-xs text-muted-foreground">Market</p>
                        <p className="text-lg font-bold text-green-500">
                            {formatPrice(marketPrice)}
                        </p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Bazaar</p>
                        <p className="text-lg font-bold text-blue-500">
                            {formatPrice(bazaarPrice)}
                        </p>
                    </div>
                </div>

                {spread && (
                    <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-xs text-muted-foreground">Spread</p>
                        <p className={`text-sm font-medium ${parseFloat(spread) > 0 ? 'text-yellow-500' : 'text-gray-500'
                            }`}>
                            {parseFloat(spread) > 0 ? '+' : ''}{spread}%
                        </p>
                    </div>
                )}

                <p className="text-xs text-muted-foreground mt-3">
                    Circ: {item.circulation.toLocaleString()}
                </p>
            </div>
        </Link>
    );
}
