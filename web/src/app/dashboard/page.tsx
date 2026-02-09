'use client';

import { useEffect, useState } from 'react';
import { api, Item } from '@/lib/api';
import { ItemCard } from '@/components/item-card';

export default function DashboardPage() {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'all' | 'watched'>('all');

    useEffect(() => {
        const fetchItems = async () => {
            try {
                const data = await api.getTrackedItems();
                // Sort: Watchlist first, then Alphabetical
                const sorted = (data || []).sort((a, b) => {
                    if (a.is_watched === b.is_watched) {
                        return a.name.localeCompare(b.name);
                    }
                    return a.is_watched ? -1 : 1;
                });
                setItems(sorted);
            } catch (err) {
                setError('Failed to load items. Make sure the API server is running.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchItems();
    }, []);

    const filteredItems = items.filter((item) => {
        const matchesSearch =
            item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.id.toString().includes(searchQuery);
        const matchesView = viewMode === 'all' || item.is_watched;
        return matchesSearch && matchesView;
    });

    return (
        <div className="min-h-screen bg-background">
            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 py-8">
                {/* Search & Header Section */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                    <div>
                        <h1 className="text-2xl font-bold">Tracked Items</h1>
                        <p className="text-muted-foreground">
                            {filteredItems.length} items
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                        <input
                            type="text"
                            placeholder="Search items..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="px-4 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full md:w-64"
                        />

                        {/* View Mode Tabs */}
                        <div className="flex bg-secondary p-1 rounded-lg self-start sm:self-auto">
                            <button
                                onClick={() => setViewMode('all')}
                                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'all'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                All Items
                            </button>
                            <button
                                onClick={() => setViewMode('watched')}
                                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'watched'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                Watchlist
                            </button>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {[...Array(8)].map((_, i) => (
                            <div
                                key={i}
                                className="bg-card border border-border rounded-lg p-4 animate-pulse"
                            >
                                <div className="h-4 bg-secondary rounded w-3/4 mb-2" />
                                <div className="h-3 bg-secondary rounded w-1/2 mb-4" />
                                <div className="h-8 bg-secondary rounded w-full" />
                            </div>
                        ))}
                    </div>
                ) : error ? (
                    <div className="text-center py-12">
                        <p className="text-destructive mb-4">{error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
                        >
                            Retry
                        </button>
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-muted-foreground">
                            {viewMode === 'watched'
                                ? "No items in your watchlist. Add items by clicking the star icon!"
                                : "No tracked items found. Add items via the API or Webhook."}
                        </p>
                    </div>
                ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredItems.map((item) => (
                            <ItemCard key={item.id} item={item} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
