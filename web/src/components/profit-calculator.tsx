'use client';

import { useState, useEffect } from 'react';
import { Item } from '@/lib/api';

interface ProfitCalculatorProps {
    item?: Item;
}

export function ProfitCalculator({ item }: ProfitCalculatorProps) {
    const [buyPrice, setBuyPrice] = useState('');
    const [sellPrice, setSellPrice] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [result, setResult] = useState<{
        profit: number;
        profitPercent: number;
        totalCost: number;
        totalRevenue: number;
    } | null>(null);

    // Pre-fill prices if item is provided
    useEffect(() => {
        if (item) {
            if (item.last_bazaar_price > 0) {
                setBuyPrice(item.last_bazaar_price.toString());
            }
            if (item.last_market_price > 0) {
                setSellPrice(item.last_market_price.toString());
            }
        }
    }, [item]);

    const calculate = () => {
        const buy = parseFloat(buyPrice) || 0;
        const sell = parseFloat(sellPrice) || 0;
        const qty = parseInt(quantity) || 1;

        const totalCost = buy * qty;
        const totalRevenue = sell * qty;
        const profit = totalRevenue - totalCost;
        const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;

        setResult({
            profit,
            profitPercent,
            totalCost,
            totalRevenue,
        });
    };

    const formatPrice = (price: number) => {
        if (price >= 1_000_000_000) return `$${(price / 1_000_000_000).toFixed(2)}B`;
        if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(2)}M`;
        if (price >= 1_000) return `$${(price / 1_000).toFixed(1)}K`;
        return `$${price.toLocaleString()}`;
    };

    const inputClass = "w-full px-2 py-1.5 text-sm bg-[#131722] border border-[#2B2B43] rounded focus:outline-none focus:ring-1 focus:ring-[#2962FF] text-[#d1d5db] placeholder-gray-500";

    return (
        <div className="space-y-3">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Profit Calc</h4>

            <div className="grid grid-cols-3 gap-2">
                <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Buy</label>
                    <input
                        type="number"
                        value={buyPrice}
                        onChange={(e) => setBuyPrice(e.target.value)}
                        placeholder="0"
                        className={inputClass}
                    />
                </div>
                <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Sell</label>
                    <input
                        type="number"
                        value={sellPrice}
                        onChange={(e) => setSellPrice(e.target.value)}
                        placeholder="0"
                        className={inputClass}
                    />
                </div>
                <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Qty</label>
                    <input
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="1"
                        min="1"
                        className={inputClass}
                    />
                </div>
            </div>

            <button
                onClick={calculate}
                className="w-full px-3 py-1.5 text-xs font-medium bg-[#2962FF] text-white rounded hover:bg-[#2962FF]/80 transition-colors"
            >
                Calculate
            </button>

            {result && (
                <div className="grid grid-cols-2 gap-2 p-2 bg-[#131722] rounded border border-[#2B2B43]">
                    <div>
                        <p className="text-[10px] text-gray-500">Cost</p>
                        <p className="text-xs font-medium text-red-400">{formatPrice(result.totalCost)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] text-gray-500">Revenue</p>
                        <p className="text-xs font-medium text-blue-400">{formatPrice(result.totalRevenue)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] text-gray-500">Profit</p>
                        <p className={`text-sm font-bold ${result.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {result.profit >= 0 ? '+' : ''}{formatPrice(result.profit)}
                        </p>
                    </div>
                    <div>
                        <p className="text-[10px] text-gray-500">ROI</p>
                        <p className={`text-sm font-bold ${result.profitPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {result.profitPercent >= 0 ? '+' : ''}{result.profitPercent.toFixed(1)}%
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
