import { useState, useEffect, useMemo } from 'react';
import { api, Item, Listing } from '@/lib/api';
import { ChevronDown } from 'lucide-react';
import { ProfitCalculator } from '@/components/profit-calculator';
import { TopListings } from '@/components/top-listings';

interface AnalysisPanelProps {
    item: Item;
    priceType: 'market' | 'bazaar';
    isWatched: boolean;
}

export function AnalysisPanel({ item, priceType, isWatched }: AnalysisPanelProps) {
    // Local state for UI toggles
    const [showCalculator, setShowCalculator] = useState(false);
    const [showAlerts, setShowAlerts] = useState(false);
    const [showTopListings, setShowTopListings] = useState(true);

    // External Prices State
    const [externalPrices, setExternalPrices] = useState<Record<string, number>>({});
    const [extLoading, setExtLoading] = useState(true);

    // Listings State (Lifted from TopListings)
    const [listings, setListings] = useState<Listing[]>([]);
    const [listingsLoading, setListingsLoading] = useState(true);

    // Alert state
    const [alertPriceAbove, setAlertPriceAbove] = useState<string>('');
    const [alertPriceBelow, setAlertPriceBelow] = useState<string>('');
    const [alertChangePercent, setAlertChangePercent] = useState<string>('');
    const [alertSaving, setAlertSaving] = useState(false);

    // Sync alert settings from item prop
    useEffect(() => {
        setAlertPriceAbove(item.alert_price_above?.toString() || '');
        setAlertPriceBelow(item.alert_price_below?.toString() || '');
        setAlertChangePercent(item.alert_change_percent?.toString() || '');
    }, [item]);

    // Fetch external prices
    useEffect(() => {
        const fetchExternalPrices = async () => {
            setExtLoading(true);
            try {
                const data = await api.getExternalPrices(item.id);
                setExternalPrices(data || {});
            } catch (err) {
                console.error('Failed to fetch external prices:', err);
            } finally {
                setExtLoading(false);
            }
        };
        fetchExternalPrices();
    }, [item.id]);

    // Fetch Top Listings
    useEffect(() => {
        const fetchListings = async () => {
            setListingsLoading(true);
            try {
                const data = await api.getTopListings(item.id, priceType);
                setListings(data || []);
            } catch (err) {
                console.error('Failed to fetch listings:', err);
            } finally {
                setListingsLoading(false);
            }
        };

        fetchListings();

        // Refresh every 30 seconds
        const interval = window.setInterval(() => {
            void api.getTopListings(item.id, priceType).then(data => {
                setListings(data || []);
            });
        }, 30000);

        return () => window.clearInterval(interval);
    }, [item.id, priceType]);

    // Calculate Top 5 Average
    const top5Average = useMemo(() => {
        if (!listings || listings.length === 0) return 0;
        // Listings are already sorted by price in backend usually, but for safety:
        // Actually backend returns sorted.
        // If bazaar, they are sorted cheapest first.
        // If market, well, market api endpoint doesn't return list, backend fabricates one?
        // Let's assume input listings are valid.
        // Filter out 0 prices if any
        const validListings = listings.filter(l => l.price > 0);
        const top5 = validListings.slice(0, 5);
        if (top5.length === 0) return 0;

        const sum = top5.reduce((acc, curr) => acc + curr.price, 0);
        return Math.floor(sum / top5.length);
    }, [listings]);

    const formatPrice = (price: number) => {
        if (price >= 1_000_000_000) return `$${(price / 1_000_000_000).toFixed(2)}B`;
        if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(2)}M`;
        if (price >= 10_000) return `$${(price / 1_000).toFixed(1)}k`;
        return `$${price.toLocaleString()}`;
    };

    const saveAlertSettings = async () => {
        setAlertSaving(true);
        try {
            await api.updateAlertSettings(item.id, {
                alert_price_above: alertPriceAbove ? parseInt(alertPriceAbove) : null,
                alert_price_below: alertPriceBelow ? parseInt(alertPriceBelow) : null,
                alert_change_percent: alertChangePercent ? parseFloat(alertChangePercent) : null,
            });
        } catch (error) {
            console.error('Failed to save alert settings:', error);
        } finally {
            setAlertSaving(false);
        }
    };

    // Derived values for Arbitrage
    const teBuyPrice = externalPrices['tornexchange_buy_price'] || 0;
    const marketPrice = item.last_market_price;
    const arbOpportunity = teBuyPrice > 0 && marketPrice > 0 && marketPrice < teBuyPrice;
    const potentialProfit = arbOpportunity ? teBuyPrice - marketPrice : 0;
    const profitPercent = arbOpportunity ? ((teBuyPrice - marketPrice) / marketPrice) * 100 : 0;

    return (
        <div className="flex flex-col h-full bg-[#131722] overflow-hidden">
            {/* Info Cards */}
            <div className="p-4 border-b border-[#2B2B43] flex flex-col gap-2 flex-none">
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-[#1e222d] p-2 rounded">
                        <div className="text-[10px] text-gray-500 uppercase">Market Price</div>
                        <div className="text-sm font-bold text-[#22c55e]">{formatPrice(item.last_market_price)}</div>
                    </div>
                    <div className="bg-[#1e222d] p-2 rounded">
                        <div className="text-[10px] text-gray-500 uppercase">Bazaar Price</div>
                        <div className="text-sm font-bold text-[#3b82f6]">{formatPrice(item.last_bazaar_price)}</div>
                    </div>
                </div>

                {/* Top 5 Avg Card */}
                {top5Average > 0 && (
                    <div className="bg-[#1e222d] p-2 rounded border border-[#2B2B43]">
                        <div className="flex justify-between items-center">
                            <div className="text-[10px] text-gray-500 uppercase">Top 5 Avg ({priceType === 'bazaar' ? 'Bazaar' : 'Market'})</div>
                            <div className="text-sm font-bold text-gray-200">{formatPrice(top5Average)}</div>
                        </div>
                    </div>
                )}

                {/* TE / Arbitrage Card */}
                <div className={`p-2 rounded border transition-colors ${arbOpportunity ? 'bg-yellow-500/10 border-yellow-500/50' : 'bg-[#1e222d] border-transparent'}`}>
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="text-[10px] text-gray-500 uppercase flex items-center gap-1">
                                TE Buy Price
                                {arbOpportunity && <span className="text-yellow-400 animate-pulse">●</span>}
                            </div>
                            <div className={`text-sm font-bold ${arbOpportunity ? 'text-yellow-400' : 'text-orange-400'}`}>
                                {extLoading ? 'Loading...' : (teBuyPrice > 0 ? formatPrice(teBuyPrice) : 'N/A')}
                            </div>
                        </div>
                        {arbOpportunity && (
                            <div className="text-right">
                                <div className="text-[10px] text-green-400 font-bold">ARBITRAGE</div>
                                <div className="text-xs text-green-300">+{formatPrice(potentialProfit)} ({profitPercent.toFixed(1)}%)</div>
                            </div>
                        )}
                        {!arbOpportunity && teBuyPrice > 0 && marketPrice > 0 && (
                            <div className="text-right">
                                <div className="text-[10px] text-gray-500 uppercase">Spread</div>
                                <div className="text-xs text-red-400">{((teBuyPrice - marketPrice) / marketPrice * 100).toFixed(1)}%</div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="text-right">
                    <div className="text-[10px] text-gray-500">Updated: {new Date(item.last_updated_at).toLocaleTimeString()}</div>
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-4 space-y-4">
                    {/* Top Listings (Now First and Collapsible) */}
                    <div className="bg-[#1e222d] rounded-lg border border-[#2B2B43] overflow-hidden">
                        <button
                            onClick={() => setShowTopListings(!showTopListings)}
                            className="w-full px-3 py-2 bg-[#2a2e39]/50 flex items-center justify-between hover:bg-[#2a2e39] transition-colors"
                        >
                            <span className="text-xs font-bold text-gray-300">
                                📊 {priceType === 'bazaar' ? 'Bazaar' : 'Market'} Listings
                            </span>
                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showTopListings ? 'rotate-180' : ''}`} />
                        </button>
                        {showTopListings && (
                            <div className="p-2 border-t border-[#2B2B43]">
                                <TopListings listings={listings} loading={listingsLoading} />
                            </div>
                        )}
                    </div>

                    {/* Alert Settings */}
                    <div className="bg-[#1e222d] rounded-lg border border-[#2B2B43] overflow-hidden">
                        <button
                            onClick={() => setShowAlerts(!showAlerts)}
                            className="w-full px-3 py-2 bg-[#2a2e39]/50 flex items-center justify-between hover:bg-[#2a2e39] transition-colors"
                        >
                            <div className="flex flex-col items-start gap-0.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-gray-300">🔔 Price Alerts</span>
                                    {isWatched ? (
                                        <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">Active</span>
                                    ) : (
                                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-500/20 text-gray-400 rounded">Add to Watchlist</span>
                                    )}
                                </div>
                                {/* Summary */}
                                {(alertPriceAbove || alertPriceBelow || alertChangePercent) && (
                                    <div className="flex flex-wrap gap-1.5 text-[10px] text-gray-500">
                                        {alertPriceAbove && <span className="text-green-400">↑ ${parseInt(alertPriceAbove).toLocaleString()}</span>}
                                        {alertPriceBelow && <span className="text-red-400">↓ ${parseInt(alertPriceBelow).toLocaleString()}</span>}
                                        {alertChangePercent && <span className="text-yellow-400">±{alertChangePercent}%</span>}
                                    </div>
                                )}
                            </div>
                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showAlerts ? 'rotate-180' : ''}`} />
                        </button>
                        {showAlerts && (
                            <div className="p-3 space-y-3 border-t border-[#2B2B43]">
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-[10px] text-gray-500 mb-0.5">Price Above</label>
                                        <input
                                            type="number"
                                            value={alertPriceAbove}
                                            onChange={(e) => setAlertPriceAbove(e.target.value)}
                                            placeholder="e.g. 100000"
                                            className="w-full px-2 py-1.5 text-sm bg-[#131722] border border-[#2B2B43] rounded focus:outline-none focus:ring-1 focus:ring-[#2962FF] text-[#d1d5db] placeholder-gray-600"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] text-gray-500 mb-0.5">Price Below</label>
                                        <input
                                            type="number"
                                            value={alertPriceBelow}
                                            onChange={(e) => setAlertPriceBelow(e.target.value)}
                                            placeholder="e.g. 50000"
                                            className="w-full px-2 py-1.5 text-sm bg-[#131722] border border-[#2B2B43] rounded focus:outline-none focus:ring-1 focus:ring-[#2962FF] text-[#d1d5db] placeholder-gray-600"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-gray-500 mb-0.5">Change %</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={alertChangePercent}
                                        onChange={(e) => setAlertChangePercent(e.target.value)}
                                        placeholder="e.g. 5"
                                        className="w-full px-2 py-1.5 text-sm bg-[#131722] border border-[#2B2B43] rounded focus:outline-none focus:ring-1 focus:ring-[#2962FF] text-[#d1d5db] placeholder-gray-600"
                                    />
                                </div>
                                <button
                                    onClick={saveAlertSettings}
                                    disabled={alertSaving || !isWatched}
                                    className={`w-full px-3 py-1.5 text-xs font-medium rounded transition-colors ${isWatched
                                        ? 'bg-[#2962FF] text-white hover:bg-[#2962FF]/80'
                                        : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                        }`}
                                >
                                    {alertSaving ? 'Saving...' : 'Save Alert Settings'}
                                </button>
                                {!isWatched && (
                                    <p className="text-[10px] text-gray-500 text-center">
                                        Add to watchlist to enable alerts
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Profit Calculator (Moved to Bottom) */}
                    <div className="bg-[#1e222d] rounded-lg border border-[#2B2B43] overflow-hidden">
                        <button
                            onClick={() => setShowCalculator(!showCalculator)}
                            className="w-full px-3 py-2 bg-[#2a2e39]/50 flex items-center justify-between hover:bg-[#2a2e39] transition-colors"
                        >
                            <span className="text-xs font-bold text-gray-300">🧮 Profit Calculator</span>
                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showCalculator ? 'rotate-180' : ''}`} />
                        </button>
                        {showCalculator && (
                            <div className="p-3 border-t border-[#2B2B43]">
                                <ProfitCalculator item={item} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
