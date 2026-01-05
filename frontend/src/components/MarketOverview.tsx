import { useMemo } from 'react';
import { Item } from '@/lib/api';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import clsx from 'clsx';

interface MarketOverviewProps {
    items: Item[];
    onSelect: (item: Item) => void;
}

export function MarketOverview({ items, onSelect }: MarketOverviewProps) {
    const { trendingUp, trendingDown } = useMemo(() => {
        // Filter items that have trend data
        const validItems = items.filter(i =>
            i.last_market_price && i.last_market_price > 0 &&
            i.last_market_trend && i.last_market_trend > 0
        );

        // Calculate diff %
        const withDiff = validItems.map(i => {
            const price = i.last_market_price!;
            const trend = i.last_market_trend!;
            const diff = price - trend;
            const percent = (diff / trend) * 100;
            return { ...i, diff, percent };
        });

        // Sort by percent desc
        const sorted = [...withDiff].sort((a, b) => b.percent - a.percent);

        // Top 5 Up (percent > 0)
        const up = sorted.filter(i => i.percent > 0).slice(0, 5);

        // Top 5 Down (percent < 0), sorted by percent asc (most negative first)
        const down = sorted.filter(i => i.percent < 0).sort((a, b) => a.percent - b.percent).slice(0, 5);

        return { trendingUp: up, trendingDown: down };
    }, [items]);

    const Card = ({ title, data, type }: { title: string, data: typeof trendingUp, type: 'up' | 'down' }) => (
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden flex-1 min-w-[300px]">
            <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
                {type === 'up' ? <TrendingUp className="text-green-500 w-5 h-5" /> : <TrendingDown className="text-red-500 w-5 h-5" />}
                <h3 className="font-bold text-lg text-white">{title}</h3>
            </div>
            <div className="divide-y divide-zinc-800/50">
                {data.length === 0 ? (
                    <div className="p-8 text-center text-zinc-500 flex flex-col items-center gap-2">
                        <Minus className="w-8 h-8 opacity-20" />
                        <p>No data available</p>
                    </div>
                ) : (
                    data.map(item => (
                        <div
                            key={item.id}
                            onClick={() => onSelect(item)}
                            className="p-3 hover:bg-zinc-800/50 cursor-pointer transition-colors flex items-center justify-between group"
                        >
                            <div className="min-w-0">
                                <div className="font-medium text-zinc-200 group-hover:text-white truncate">{item.name}</div>
                                <div className="text-xs text-zinc-500">ID: {item.torn_id}</div>
                            </div>
                            <div className="text-right">
                                <div className="font-mono text-white font-bold">
                                    ${item.last_market_price?.toLocaleString()}
                                </div>
                                <div className={clsx(
                                    "text-xs font-mono",
                                    item.percent > 0 ? "text-green-500" : "text-red-500"
                                )}>
                                    {item.percent > 0 ? '+' : ''}{item.percent.toFixed(2)}%
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    return (
        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-6">Market Overview</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Market Stats */}
                <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="bg-zinc-900 p-4 rounded-lg border border-zinc-800">
                        <p className="text-xs text-zinc-500 uppercase">Tracked Items</p>
                        <p className="text-2xl font-bold text-white">{items.length}</p>
                    </div>
                    {/* Add more global stats if available later */}
                </div>

                <Card title="Top Gainers (24h)" data={trendingUp} type="up" />
                <Card title="Top Losers (24h)" data={trendingDown} type="down" />
            </div>
        </div>
    );
}
