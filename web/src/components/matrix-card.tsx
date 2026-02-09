'use client';

import { useEffect, useState } from 'react';
import { api, Item, PriceCandle } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowUp, ArrowDown, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface MatrixCardProps {
    item: Item;
}

export function MatrixCard({ item }: MatrixCardProps) {
    const [history, setHistory] = useState<PriceCandle[]>([]);
    const [loading, setLoading] = useState(true);

    // Calculate 24h change
    const [changePct, setChangePct] = useState<number | null>(null);
    const [trend, setTrend] = useState<'up' | 'down' | 'neutral'>('neutral');

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const data = await api.getPriceHistory(item.id, { interval: '1h', days: 1 }) || [];
                setHistory(data);

                if (data.length > 0) {
                    const firstPrice = data[0].close; // Price 24h ago (approx)
                    const lastPrice = item.last_market_price;

                    if (firstPrice > 0) {
                        const diff = lastPrice - firstPrice;
                        const pct = (diff / firstPrice) * 100;
                        setChangePct(pct);
                        setTrend(pct >= 0 ? 'up' : 'down');
                    }
                }
            } catch (err) {
                console.error(`Failed to load history for ${item.id}`, err);
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();
    }, [item.id, item.last_market_price]);

    // Simple Sparkline
    const renderSparkline = () => {
        if (loading || history.length < 2) return null;

        const width = 120;
        const height = 40;
        const min = Math.min(...history.map(c => c.close));
        const max = Math.max(...history.map(c => c.close));
        const range = max - min || 1; // Avoid division by zero

        const points = history.map((c, i) => {
            const x = (i / (history.length - 1)) * width;
            const y = height - ((c.close - min) / range) * height;
            return `${x},${y}`;
        }).join(' ');

        return (
            <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
                <polyline
                    points={points}
                    fill="none"
                    stroke={trend === 'up' ? '#22c55e' : '#ef4444'}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        );
    };

    return (
        <Card className="hover:shadow-lg transition-shadow bg-card/50 backdrop-blur-sm border-border/50">
            <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                    <div>
                        <Link href={`/items/${item.id}`} className="font-bold hover:underline truncate block max-w-[120px]" title={item.name}>
                            {item.name}
                        </Link>
                        <span className="text-xs text-muted-foreground">ID: {item.id}</span>
                    </div>
                    <a
                        href={`https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${item.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-primary"
                    >
                        <ExternalLink className="w-3 h-3" />
                    </a>
                </div>

                <div className="h-10 mb-3 w-full">
                    {renderSparkline()}
                </div>

                <div className="flex justify-between items-end">
                    <div>
                        <div className="text-lg font-mono font-bold">
                            ${item.last_market_price.toLocaleString()}
                        </div>
                        <div className={`text-xs flex items-center ${trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-muted-foreground'}`}>
                            {changePct !== null ? (
                                <>
                                    {trend === 'up' ? <ArrowUp className="w-3 h-3 mr-0.5" /> : <ArrowDown className="w-3 h-3 mr-0.5" />}
                                    {Math.abs(changePct).toFixed(2)}%
                                </>
                            ) : (
                                <span className="opacity-50">--%</span>
                            )}
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
