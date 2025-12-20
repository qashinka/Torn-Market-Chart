import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export interface PricePoint {
    timestamp: string;
    market_price: number;
    bazaar_price: number;
}

interface PriceChartProps {
    data: PricePoint[];
    title: string;
}

export function PriceChart({ data, title }: PriceChartProps) {
    return (
        <Card className="w-full h-[400px]">
            <CardHeader>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                        <XAxis
                            dataKey="timestamp"
                            tickFormatter={(str) => new Date(str).toLocaleTimeString()}
                        />
                        <YAxis />
                        <Tooltip
                            labelFormatter={(label) => new Date(label).toLocaleString()}
                        />
                        <Line type="monotone" dataKey="market_price" stroke="#8884d8" name="Market" />
                        <Line type="monotone" dataKey="bazaar_price" stroke="#82ca9d" name="Bazaar" />
                    </LineChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}
