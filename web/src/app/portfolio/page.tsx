'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api, Item } from '@/lib/api';

interface PortfolioItem {
    itemId: number;
    name: string;
    quantity: number;
    buyPrice: number;
    currentPrice: number;
}

export default function PortfolioPage() {
    const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [newItem, setNewItem] = useState({ itemId: 0, quantity: 1, buyPrice: 0 });

    useEffect(() => {
        // Load portfolio from localStorage
        const saved = localStorage.getItem('torn_portfolio');
        if (saved) {
            setPortfolio(JSON.parse(saved));
        }

        // Fetch items for dropdown
        api.getTrackedItems().then((data) => {
            setItems(data || []);
            setLoading(false);
        });
    }, []);

    useEffect(() => {
        // Update current prices periodically
        const updatePrices = async () => {
            if (portfolio.length === 0) return;

            const updated = await Promise.all(
                portfolio.map(async (p) => {
                    try {
                        const item = await api.getItem(p.itemId);
                        return { ...p, currentPrice: item.last_market_price };
                    } catch {
                        return p;
                    }
                })
            );
            setPortfolio(updated);
        };

        updatePrices();
        const interval = setInterval(updatePrices, 60000);
        return () => clearInterval(interval);
    }, [portfolio.length]);

    const savePortfolio = (newPortfolio: PortfolioItem[]) => {
        setPortfolio(newPortfolio);
        localStorage.setItem('torn_portfolio', JSON.stringify(newPortfolio));
    };

    const addItem = () => {
        const item = items.find((i) => i.id === newItem.itemId);
        if (!item || newItem.quantity <= 0) return;

        const portfolioItem: PortfolioItem = {
            itemId: item.id,
            name: item.name,
            quantity: newItem.quantity,
            buyPrice: newItem.buyPrice || item.last_market_price,
            currentPrice: item.last_market_price,
        };

        savePortfolio([...portfolio, portfolioItem]);
        setNewItem({ itemId: 0, quantity: 1, buyPrice: 0 });
        setShowAdd(false);
    };

    const removeItem = (index: number) => {
        savePortfolio(portfolio.filter((_, i) => i !== index));
    };

    const formatPrice = (price: number) => {
        if (price >= 1_000_000_000) return `$${(price / 1_000_000_000).toFixed(2)}B`;
        if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(2)}M`;
        if (price >= 1_000) return `$${(price / 1_000).toFixed(1)}K`;
        return `$${price.toLocaleString()}`;
    };

    const totals = portfolio.reduce(
        (acc, p) => ({
            cost: acc.cost + p.buyPrice * p.quantity,
            value: acc.value + p.currentPrice * p.quantity,
        }),
        { cost: 0, value: 0 }
    );
    const totalProfit = totals.value - totals.cost;
    const totalProfitPct = totals.cost > 0 ? (totalProfit / totals.cost) * 100 : 0;

    return (
        <div className="min-h-screen bg-background">
            <div className="max-w-7xl mx-auto px-4 py-8">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-xl font-bold">Portfolio Tracker</h1>
                    <button
                        onClick={() => setShowAdd(true)}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium"
                    >
                        + Add Item
                    </button>
                </div>
                {/* Summary Cards */}
                <div className="grid md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-card border border-border rounded-lg p-4">
                        <p className="text-sm text-muted-foreground">Total Cost</p>
                        <p className="text-2xl font-bold text-red-400">{formatPrice(totals.cost)}</p>
                    </div>
                    <div className="bg-card border border-border rounded-lg p-4">
                        <p className="text-sm text-muted-foreground">Current Value</p>
                        <p className="text-2xl font-bold text-blue-400">{formatPrice(totals.value)}</p>
                    </div>
                    <div className="bg-card border border-border rounded-lg p-4">
                        <p className="text-sm text-muted-foreground">Total Profit</p>
                        <p className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {totalProfit >= 0 ? '+' : ''}{formatPrice(totalProfit)}
                        </p>
                    </div>
                    <div className="bg-card border border-border rounded-lg p-4">
                        <p className="text-sm text-muted-foreground">ROI</p>
                        <p className={`text-2xl font-bold ${totalProfitPct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {totalProfitPct >= 0 ? '+' : ''}{totalProfitPct.toFixed(1)}%
                        </p>
                    </div>
                </div>

                {/* Portfolio Table */}
                {portfolio.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-muted-foreground mb-4">No items in portfolio</p>
                        <button
                            onClick={() => setShowAdd(true)}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
                        >
                            Add Your First Item
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-3 px-2">Item</th>
                                    <th className="text-right py-3 px-2">Qty</th>
                                    <th className="text-right py-3 px-2">Buy Price</th>
                                    <th className="text-right py-3 px-2">Current</th>
                                    <th className="text-right py-3 px-2">P/L</th>
                                    <th className="text-right py-3 px-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {portfolio.map((p, index) => {
                                    const profit = (p.currentPrice - p.buyPrice) * p.quantity;
                                    const profitPct = p.buyPrice > 0 ? ((p.currentPrice - p.buyPrice) / p.buyPrice) * 100 : 0;
                                    return (
                                        <tr key={index} className="border-b border-border/50">
                                            <td className="py-3 px-2">
                                                <Link href={`/items/${p.itemId}`} className="hover:text-primary">
                                                    {p.name}
                                                </Link>
                                            </td>
                                            <td className="py-3 px-2 text-right">{p.quantity}</td>
                                            <td className="py-3 px-2 text-right">{formatPrice(p.buyPrice)}</td>
                                            <td className="py-3 px-2 text-right">{formatPrice(p.currentPrice)}</td>
                                            <td className={`py-3 px-2 text-right font-medium ${profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                {profit >= 0 ? '+' : ''}{formatPrice(profit)} ({profitPct >= 0 ? '+' : ''}{profitPct.toFixed(1)}%)
                                            </td>
                                            <td className="py-3 px-2 text-right">
                                                <button
                                                    onClick={() => removeItem(index)}
                                                    className="text-red-400 hover:text-red-300"
                                                >
                                                    ×
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Add Modal */}
                {showAdd && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md">
                            <h2 className="text-lg font-semibold mb-4">Add to Portfolio</h2>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm text-muted-foreground mb-1">Item</label>
                                    <select
                                        value={newItem.itemId}
                                        onChange={(e) => setNewItem({ ...newItem, itemId: parseInt(e.target.value) })}
                                        className="w-full px-3 py-2 bg-secondary border border-border rounded-lg"
                                    >
                                        <option value={0}>Select item...</option>
                                        {items.map((item) => (
                                            <option key={item.id} value={item.id}>
                                                {item.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-muted-foreground mb-1">Quantity</label>
                                    <input
                                        type="number"
                                        value={newItem.quantity}
                                        onChange={(e) => setNewItem({ ...newItem, quantity: parseInt(e.target.value) || 1 })}
                                        min="1"
                                        className="w-full px-3 py-2 bg-secondary border border-border rounded-lg"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-muted-foreground mb-1">Buy Price (leave 0 for current)</label>
                                    <input
                                        type="number"
                                        value={newItem.buyPrice}
                                        onChange={(e) => setNewItem({ ...newItem, buyPrice: parseInt(e.target.value) || 0 })}
                                        className="w-full px-3 py-2 bg-secondary border border-border rounded-lg"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-2 mt-6">
                                <button
                                    onClick={() => setShowAdd(false)}
                                    className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={addItem}
                                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg"
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
