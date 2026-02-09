'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, Item, PriceCandle } from '@/lib/api';
import { Star, ArrowLeft } from 'lucide-react';
import { PriceChart } from '@/components/price-chart';
import { ItemDetailsSidebar } from '@/components/item-details/sidebar';

type Interval = '1m' | '15m' | '1h' | '4h' | '1d';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

export default function ItemDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { isAuthenticated } = useAuth();
    const itemId = Number(params.id);

    const [item, setItem] = useState<Item | null>(null);
    const [priceData, setPriceData] = useState<PriceCandle[]>([]);
    const [loading, setLoading] = useState(true);
    const [interval, setInterval] = useState<Interval>('1h');
    const [days, setDays] = useState(7);
    const [priceType, setPriceType] = useState<'market' | 'bazaar'>('bazaar');
    const [isWatched, setIsWatched] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Update isWatched when item is loaded
    useEffect(() => {
        if (item) {
            setIsWatched(item.is_watched || false);
        }
    }, [item]);

    // Fetch data function - extracted for reuse
    const fetchData = useCallback(async (isPolling = false) => {
        if (!isPolling) setLoading(true);
        try {
            const [itemData, historyData] = await Promise.all([
                api.getItem(itemId),
                api.getPriceHistory(itemId, { interval, days, type: priceType }),
            ]);
            setItem(itemData);
            setPriceData(historyData || []);
        } catch (err) {
            console.error('Failed to fetch item data:', err);
        } finally {
            if (!isPolling) setLoading(false);
        }
    }, [itemId, interval, days, priceType]);

    // Initial fetch and on parameter change
    useEffect(() => {
        if (itemId) {
            fetchData();
        }
    }, [fetchData]);

    // Polling interval for real-time updates (10 seconds)
    useEffect(() => {
        if (!itemId) return;

        const pollInterval = window.setInterval(() => {
            void fetchData(true); // true = polling mode, don't show loading
        }, 10000); // 10 seconds

        return () => window.clearInterval(pollInterval);
    }, [itemId, fetchData]);

    const handleWatchToggle = async () => {
        if (!isAuthenticated) {
            router.push('/settings');
            return;
        }

        if (!item || isUpdating) return;

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

    if (loading) {
        return (
            <div className="h-screen w-full bg-[#131722] flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-[#2962FF] border-t-transparent rounded-full" />
            </div>
        );
    }

    if (!item) {
        return (
            <div className="h-screen w-full bg-[#131722] flex items-center justify-center">
                <div className="text-center text-[#d1d5db]">
                    <p className="mb-4">Item not found</p>
                    <Link href="/dashboard" className="text-[#2962FF] hover:underline">
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen w-screen bg-[#131722] text-[#d1d5db] overflow-hidden">
            {/* Top Toolbar */}
            <header className="flex-none h-12 border-b border-[#2B2B43] flex items-center px-4 justify-between bg-[#131722]">
                <div className="flex items-center gap-4">
                    <Link href="/dashboard" className="text-gray-400 hover:text-white transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-lg tracking-wide text-[#e1e1e1]">{item.name}</span>
                        <span className="text-xs bg-[#2B2B43] px-1.5 py-0.5 rounded text-gray-400">ID: {item.id}</span>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    {/* Timeframe Selectors */}
                    <div className="flex items-center bg-[#1e222d] rounded-md p-0.5 mx-2">
                        {(['1m', '15m', '1h', '4h', '1d'] as Interval[]).map((i) => (
                            <button
                                key={i}
                                onClick={() => setInterval(i)}
                                className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${interval === i ? 'bg-[#2a2e39] text-[#d1d5db] shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                            >
                                {i}
                            </button>
                        ))}
                    </div>

                    <div className="w-px h-4 bg-[#2B2B43] mx-1" />

                    {/* Period Selectors */}
                    <div className="flex items-center">
                        {[1, 7, 30, 90].map((d) => (
                            <button
                                key={d}
                                onClick={() => setDays(d)}
                                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${days === d ? 'text-[#2962FF]' : 'text-gray-500 hover:text-gray-300'}`}
                            >
                                {d}D
                            </button>
                        ))}
                    </div>

                    <div className="w-px h-4 bg-[#2B2B43] mx-1" />

                    {/* Chart Type Toggle / Source Toggle */}
                    <div className="flex items-center bg-[#1e222d] rounded-md p-0.5 mx-2">
                        <button
                            onClick={() => setPriceType('market')}
                            className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${priceType === 'market' ? 'bg-[#2a2e39] text-[#22c55e]' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                            Market
                        </button>
                        <button
                            onClick={() => setPriceType('bazaar')}
                            className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${priceType === 'bazaar' ? 'bg-[#2a2e39] text-[#3b82f6]' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                            Bazaar
                        </button>
                    </div>

                    <button
                        onClick={handleWatchToggle}
                        className={`p-2 rounded hover:bg-[#2a2e39] transition-colors ${isWatched ? 'text-yellow-400' : 'text-gray-400'}`}
                    >
                        <Star className="w-5 h-5" fill={isWatched ? "currentColor" : "none"} />
                    </button>
                </div>
            </header>

            {/* Main Workspace */}
            <div className="flex flex-1 overflow-hidden relative">
                {/* Chart Area */}
                <div className={`flex-1 relative flex flex-col min-w-0 transition-all ${isFullscreen ? 'fixed inset-0 z-50 bg-[#131722]' : ''}`}>
                    <div className="flex-1 w-full h-full p-1">
                        {priceData.length > 0 ? (
                            <PriceChart
                                data={priceData}
                                height={undefined}
                                isFullscreen={isFullscreen}
                                onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-500 border border-[#2B2B43] rounded-lg">
                                No Data
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Sidebar - Details & Watchlist */}
                {!isFullscreen && (
                    <ItemDetailsSidebar item={item} priceType={priceType} isWatched={isWatched} />
                )}
            </div>
        </div>
    );
}
