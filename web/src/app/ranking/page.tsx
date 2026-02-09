'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Item } from '@/lib/api';

type SortField = 'name' | 'market_price' | 'bazaar_price' | 'spread' | 'circulation';
type SortOrder = 'asc' | 'desc';

export default function RankingPage() {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [sortField, setSortField] = useState<SortField>('market_price');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
    const [filterType, setFilterType] = useState<string>('all');

    useEffect(() => {
        const fetchItems = async () => {
            try {
                const data = await api.getTrackedItems();
                setItems(data || []);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchItems();
    }, []);

    const calculateSpread = (item: Item) => {
        if (item.last_market_price > 0 && item.last_bazaar_price > 0) {
            return ((item.last_market_price - item.last_bazaar_price) / item.last_bazaar_price) * 100;
        }
        return 0;
    };

    const sortedItems = [...items]
        .filter((item) => filterType === 'all' || item.type === filterType)
        .sort((a, b) => {
            let aVal: number, bVal: number;
            switch (sortField) {
                case 'name':
                    return sortOrder === 'asc'
                        ? a.name.localeCompare(b.name)
                        : b.name.localeCompare(a.name);
                case 'market_price':
                    aVal = a.last_market_price;
                    bVal = b.last_market_price;
                    break;
                case 'bazaar_price':
                    aVal = a.last_bazaar_price;
                    bVal = b.last_bazaar_price;
                    break;
                case 'spread':
                    aVal = calculateSpread(a);
                    bVal = calculateSpread(b);
                    break;
                case 'circulation':
                    aVal = a.circulation;
                    bVal = b.circulation;
                    break;
                default:
                    return 0;
            }
            return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        });

    const formatPrice = (price: number) => {
        if (price >= 1_000_000_000) return `$${(price / 1_000_000_000).toFixed(2)}B`;
        if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(2)}M`;
        if (price >= 1_000) return `$${(price / 1_000).toFixed(1)}K`;
        return `$${price.toLocaleString()}`;
    };

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('desc');
        }
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return null;
        return sortOrder === 'asc' ? ' ↑' : ' ↓';
    };

    // Get unique types
    const types = ['all', ...new Set(items.map((i) => i.type).filter(Boolean))];

    return (
        <div className="min-h-screen bg-background">
            <div className="max-w-7xl mx-auto px-4 py-8">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-xl font-bold">Market Ranking</h1>
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="px-3 py-2 bg-secondary border border-border rounded-lg"
                    >
                        {types.map((type) => (
                            <option key={type} value={type}>
                                {type === 'all' ? 'All Types' : type}
                            </option>
                        ))}
                    </select>
                </div>
                {loading ? (
                    <div className="animate-pulse space-y-2">
                        {[...Array(10)].map((_, i) => (
                            <div key={i} className="h-12 bg-secondary rounded" />
                        ))}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-3 px-2">#</th>
                                    <th
                                        className="text-left py-3 px-2 cursor-pointer hover:text-primary"
                                        onClick={() => handleSort('name')}
                                    >
                                        Name<SortIcon field="name" />
                                    </th>
                                    <th
                                        className="text-right py-3 px-2 cursor-pointer hover:text-primary"
                                        onClick={() => handleSort('market_price')}
                                    >
                                        Market<SortIcon field="market_price" />
                                    </th>
                                    <th
                                        className="text-right py-3 px-2 cursor-pointer hover:text-primary"
                                        onClick={() => handleSort('bazaar_price')}
                                    >
                                        Bazaar<SortIcon field="bazaar_price" />
                                    </th>
                                    <th
                                        className="text-right py-3 px-2 cursor-pointer hover:text-primary"
                                        onClick={() => handleSort('spread')}
                                    >
                                        Spread<SortIcon field="spread" />
                                    </th>
                                    <th
                                        className="text-right py-3 px-2 cursor-pointer hover:text-primary"
                                        onClick={() => handleSort('circulation')}
                                    >
                                        Circulation<SortIcon field="circulation" />
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedItems.map((item, index) => {
                                    const spread = calculateSpread(item);
                                    return (
                                        <tr
                                            key={item.id}
                                            className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                                        >
                                            <td className="py-3 px-2 text-muted-foreground">{index + 1}</td>
                                            <td className="py-3 px-2">
                                                <Link href={`/items/${item.id}`} className="hover:text-primary">
                                                    <span className="font-medium">{item.name}</span>
                                                    <span className="text-xs text-muted-foreground ml-2">#{item.id}</span>
                                                </Link>
                                            </td>
                                            <td className="py-3 px-2 text-right text-green-500 font-medium">
                                                {formatPrice(item.last_market_price)}
                                            </td>
                                            <td className="py-3 px-2 text-right text-blue-500 font-medium">
                                                {formatPrice(item.last_bazaar_price)}
                                            </td>
                                            <td className={`py-3 px-2 text-right font-medium ${spread > 5 ? 'text-yellow-500' : spread > 0 ? 'text-gray-400' : 'text-red-400'
                                                }`}>
                                                {spread > 0 ? '+' : ''}{spread.toFixed(1)}%
                                            </td>
                                            <td className="py-3 px-2 text-right text-muted-foreground">
                                                {item.circulation.toLocaleString()}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
