'use client';

import { useEffect, useState } from 'react';
import { api, Item } from '@/lib/api';
import { MatrixCard } from '@/components/matrix-card';
import { useAuth } from '@/contexts/auth-context';
import Link from 'next/link';
import { Building2 } from 'lucide-react';

export default function WatchlistPage() {
    const { isAuthenticated, isLoading: authLoading } = useAuth();
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) return;

        const fetchItems = async () => {
            try {
                // Fetch ONLY watched items
                const data = await api.getWatchedItems();
                setItems(data);
            } catch (err) {
                console.error("Failed to fetch watchlist", err);
            } finally {
                setLoading(false);
            }
        };

        fetchItems();

        const interval = setInterval(fetchItems, 30000); // 30s
        return () => clearInterval(interval);
    }, [isAuthenticated, authLoading]);

    if (authLoading) {
        return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
    }

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-4 text-center">
                <div className="h-20 w-20 rounded-full bg-secondary/30 flex items-center justify-center mb-4">
                    <Building2 className="h-10 w-10 text-muted-foreground" />
                </div>
                <h2 className="text-2xl font-bold">Sign In Required</h2>
                <p className="text-muted-foreground max-w-md">
                    Please connect your Torn account to view and manage your personal watchlist.
                </p>
                <Link
                    href="/settings"
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors mt-4"
                >
                    Go to Settings
                </Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="max-w-7xl mx-auto px-4 py-8">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">Market Matrix</h1>
                    <div className="text-sm text-muted-foreground">
                        {items.length} items monitored
                    </div>
                </div>

                {loading ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {[...Array(12)].map((_, i) => (
                            <div key={i} className="h-32 bg-secondary/20 rounded-lg animate-pulse" />
                        ))}
                    </div>
                ) : items.length === 0 ? (
                    <div className="text-center py-20 text-muted-foreground">
                        <p className="mb-2">No items in your watchlist.</p>
                        <p className="text-sm">Go to Dashboard and click the star icon to track items.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {items.map((item) => (
                            <MatrixCard key={item.id} item={item} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
