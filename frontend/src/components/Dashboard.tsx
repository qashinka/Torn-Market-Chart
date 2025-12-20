import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PriceChart } from './PriceChart';

// Mock data fetcher
const fetchItems = async () => {
    // In real app: axios.get('/api/v1/items')
    return [
        { id: 1, name: "Xanax", last_market_price: 840000, last_bazaar_price: 835000 },
        { id: 2, name: "Donator Pack", last_market_price: 24000000, last_bazaar_price: 23800000 },
    ];
};

const fetchHistory = async (itemId: number) => {
    // Mock history
    const now = new Date();
    return Array.from({ length: 20 }, (_, i) => ({
        timestamp: new Date(now.getTime() - i * 3600000).toISOString(),
        market_price: 840000 + Math.random() * 5000,
        bazaar_price: 835000 + Math.random() * 5000
    })).reverse();
}

export function Dashboard() {
    const { data: items } = useQuery({ queryKey: ['items'], queryFn: fetchItems });
    const { data: history } = useQuery({ queryKey: ['history', 1], queryFn: () => fetchHistory(1) });

    return (
        <div className="p-8 space-y-8 bg-black min-h-screen text-white">
            <h1 className="text-3xl font-bold">Torn Market Tracker</h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {items?.map(item => (
                    <Card key={item.id} className="bg-zinc-900 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-white">{item.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex justify-between">
                                <div>
                                    <p className="text-sm text-gray-400">Market</p>
                                    <p className="text-xl font-bold text-green-400">${item.last_market_price?.toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-400">Bazaar</p>
                                    <p className="text-xl font-bold text-blue-400">${item.last_bazaar_price?.toLocaleString()}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {history && <PriceChart data={history} title="Xanax Price History (24h)" />}
        </div>
    );
}
