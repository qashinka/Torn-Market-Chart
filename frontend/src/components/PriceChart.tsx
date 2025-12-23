import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, Time, LineStyle, AreaSeries, LineSeries } from 'lightweight-charts';
import { PricePoint } from '@/lib/api';
import { calculateMovingAverage } from '@/lib/stats';

export interface PriceChartProps {
    data: PricePoint[];
}

export function PriceChart({ data }: PriceChartProps) {
    const [showTrend, setShowTrend] = useState(false);
    const [legendData, setLegendData] = useState<{
        marketLow?: number;
        bazaarLow?: number;
        marketAvg?: number;
        bazaarAvg?: number;
        marketMa?: number;
        bazaarMa?: number;
        dateStr?: string;
    } | null>(null);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    // Keep references to series to update them
    const seriesRefs = useRef<{
        marketLow?: ISeriesApi<"Area">;
        bazaarLow?: ISeriesApi<"Area">;
        marketAvg?: ISeriesApi<"Line">;
        bazaarAvg?: ISeriesApi<"Line">;
        marketMa?: ISeriesApi<"Line">;
        bazaarMa?: ISeriesApi<"Line">;
    }>({});

    // Process data for the chart
    const chartData = useMemo(() => {
        // Calculate MA if needed, otherwise just use data
        // We always calculate MA if showTrend is true, or just pass raw data if not
        // Actually calculateMovingAverage returns the original points plus MA fields.
        // It's cheap enough to calculate if we need it, or we can just calculate always if data is small.
        // But let's respect the toggle for calculation if it was heavy, though here it's fine.
        return calculateMovingAverage(data, 24);
    }, [data]);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // 1. Create Chart
        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#71717a', // zinc-500
                fontFamily: "'Inter', sans-serif",
            },
            grid: {
                vertLines: { color: '#27272a' }, // zinc-800
                horzLines: { color: '#27272a' },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: '#27272a',
            },
            localization: {
                // Force JST display on the time axis
                timeFormatter: (timestamp: number) => {
                    return new Date(timestamp * 1000).toLocaleString('ja-JP', {
                        timeZone: 'Asia/Tokyo',
                        hour: '2-digit',
                        minute: '2-digit',
                    });
                },
                dateFormat: 'yyyy/MM/dd',
            },
            rightPriceScale: {
                borderColor: '#27272a',
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.1,
                },
            },
            crosshair: {
                mode: 1, // Magnet
                vertLine: {
                    color: '#3f3f46',
                    labelBackgroundColor: '#3f3f46',
                },
                horzLine: {
                    color: '#3f3f46',
                    labelBackgroundColor: '#3f3f46',
                },
            }
        });

        chartRef.current = chart;

        // 2. Create Series

        // Market Low (Area - Green)
        const marketLowSeries = chart.addSeries(AreaSeries, {
            lineColor: '#22c55e',
            topColor: 'rgba(34, 197, 94, 0.4)',
            bottomColor: 'rgba(34, 197, 94, 0.0)',
            lineWidth: 2,
            priceFormat: { type: 'price', precision: 0, minMove: 1 },
        });
        seriesRefs.current.marketLow = marketLowSeries;

        // Bazaar Low (Area - Blue)
        const bazaarLowSeries = chart.addSeries(AreaSeries, {
            lineColor: '#3b82f6',
            topColor: 'rgba(59, 130, 246, 0.4)',
            bottomColor: 'rgba(59, 130, 246, 0.0)',
            lineWidth: 2,
            priceFormat: { type: 'price', precision: 0, minMove: 1 },
        });
        seriesRefs.current.bazaarLow = bazaarLowSeries;

        // Market Avg (Line - Brighter Green, Dashed)
        const marketAvgSeries = chart.addSeries(LineSeries, {
            color: '#4ade80', // green-400 (Brighter for visibility on dark bg)
            lineWidth: 2, // Thicker
            lineStyle: LineStyle.Dashed,
            priceFormat: { type: 'price', precision: 0, minMove: 1 },
            crosshairMarkerVisible: true,
        });
        seriesRefs.current.marketAvg = marketAvgSeries;

        // Bazaar Avg (Line - Brighter Blue, Dashed)
        const bazaarAvgSeries = chart.addSeries(LineSeries, {
            color: '#60a5fa', // blue-400 (Brighter)
            lineWidth: 2, // Thicker
            lineStyle: LineStyle.Dashed,
            priceFormat: { type: 'price', precision: 0, minMove: 1 },
            crosshairMarkerVisible: true,
        });
        seriesRefs.current.bazaarAvg = bazaarAvgSeries;

        // Moving Averages (Lines - Hidden by default if we didn't add them, but let's add and set data conditionally)
        // Trend Lines
        const marketMaSeries = chart.addSeries(LineSeries, {
            color: '#d946ef', // Fuchsia
            lineWidth: 2,
            priceFormat: { type: 'price', precision: 0, minMove: 1 },
            title: 'Market Trend',
            visible: showTrend, // Use visible property
        });
        seriesRefs.current.marketMa = marketMaSeries;

        const bazaarMaSeries = chart.addSeries(LineSeries, {
            color: '#f97316', // Orange
            lineWidth: 2,
            priceFormat: { type: 'price', precision: 0, minMove: 1 },
            title: 'Bazaar Trend',
            visible: showTrend,
        });
        seriesRefs.current.bazaarMa = bazaarMaSeries;

        // 3. Crosshair handler
        chart.subscribeCrosshairMove(param => {
            if (
                param.point === undefined ||
                !param.time ||
                param.point.x < 0 ||
                param.point.x > chartContainerRef.current!.clientWidth ||
                param.point.y < 0 ||
                param.point.y > chartContainerRef.current!.clientHeight
            ) {
                // Determine what to show when not hovering? Last valid? Or null?
                // Keeping previous value or specific handling might be better. 
                // For now, let's just leave it (don't clear) to show last selected or maybe clear if needed.
                // setLegendData(null); 
                return;
            }

            // Retrieve values
            // In lightweight-charts v4+, .get() returns the data item created { time, value, ... }
            // So we need to access .value property if it exists.

            // Helper to get value safely
            const getValue = (series: ISeriesApi<any>): number | undefined => {
                const data = param.seriesData.get(series);
                if (data === undefined || data === null) return undefined;
                // Handle standard object with value (Area/Line)
                if (typeof data === 'object' && 'value' in data) {
                    return (data as any).value;
                }
                // Handle raw number
                if (typeof data === 'number') {
                    return data;
                }
                // Fallback for Candidate/Bar if ever swapped
                if (typeof data === 'object' && 'close' in data) {
                    return (data as any).close;
                }
                return undefined;
            };

            const marketLow = getValue(marketLowSeries);
            const bazaarLow = getValue(bazaarLowSeries);
            const marketAvg = getValue(marketAvgSeries);
            const bazaarAvg = getValue(bazaarAvgSeries);
            const marketMa = getValue(marketMaSeries);
            const bazaarMa = getValue(bazaarMaSeries);

            // Format time
            // param.time is the time scale value (seconds in our case)
            const date = new Date((param.time as number) * 1000);
            const dateStr = date.toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo',
                month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            setLegendData({
                marketLow,
                bazaarLow,
                marketAvg,
                bazaarAvg,
                marketMa,
                bazaarMa,
                dateStr,
            });
        });

        // 3. Handle Resize
        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []); // Create chart once on mount

    // 4. Update Data Effect
    useEffect(() => {
        if (!chartData || chartData.length === 0) return;

        // Update visibility options dynamically
        seriesRefs.current.marketMa?.applyOptions({ visible: showTrend });
        seriesRefs.current.bazaarMa?.applyOptions({ visible: showTrend });

        // Transform data for Lightweight Chart
        // Time needs to be UNIX timestamp in seconds

        const marketLowData = [];
        const bazaarLowData = [];
        const marketAvgData = [];
        const bazaarAvgData = [];
        const marketMaData = [];
        const bazaarMaData = [];

        for (const pt of chartData) {
            const time = (new Date(pt.timestamp).getTime() / 1000) as Time;

            // Check against null/undefined AND 0 (to avoid drops to zero line)
            if (pt.market_price != null && pt.market_price > 0) {
                marketLowData.push({ time, value: pt.market_price });
            }
            if (pt.bazaar_price != null && pt.bazaar_price > 0) {
                bazaarLowData.push({ time, value: pt.bazaar_price });
            }

            // AVG data logic
            if (pt.market_price_avg != null && pt.market_price_avg > 0) {
                marketAvgData.push({ time, value: pt.market_price_avg });
            }
            if (pt.bazaar_price_avg != null && pt.bazaar_price_avg > 0) {
                bazaarAvgData.push({ time, value: pt.bazaar_price_avg });
            }

            // Trend data is calculated in hook, likely safe, but check anyway
            if (pt.market_price_ma != null && pt.market_price_ma > 0) {
                marketMaData.push({ time, value: pt.market_price_ma });
            }
            if (pt.bazaar_price_ma != null && pt.bazaar_price_ma > 0) {
                bazaarMaData.push({ time, value: pt.bazaar_price_ma });
            }
        }

        seriesRefs.current.marketLow?.setData(marketLowData);
        seriesRefs.current.bazaarLow?.setData(bazaarLowData);
        seriesRefs.current.marketAvg?.setData(marketAvgData);
        seriesRefs.current.bazaarAvg?.setData(bazaarAvgData);


        // Always set data, visibility controls display
        seriesRefs.current.marketMa?.setData(marketMaData);
        seriesRefs.current.bazaarMa?.setData(bazaarMaData);

        // ONLY fit content if this is a "New Load" (e.g. data length changed significantly from 0 or just loaded).
        // For now, let's auto-fit only if we haven't fitted yet or user requests it. 
        // But the user requirement is "When changing items". 
        // A simple heuristic: if we just got a fresh batch of history (e.g. different item), we should fit.
        // We can check if the time range is completely different.
        // For now, let's just NOT fit on every update, and provide a button or do it only on mount/item change.
        // Actually, the `data` prop changes only when item changes or new poll arrives. 
        // If item changes, `data` is a whole new array. 
        // We can use a ref to track the last ID or something, but `data` reference changing is enough signal?

        // Strategy: 
        // 1. If data is completely empty -> do nothing.
        // 2. If data is populated and we haven't set the logical range -> fit.
        // 3. If user is scrolling, we don't want to snap back on poll update.
        // lightweight-charts handles scrolling state internally, fitContent() forces reset.

        // Fix: Just run fitContent ONCE when data length goes from 0 to N (initial load).
        // Then user can manually reset if needed.
        if (marketLowData.length > 0) {
            // Check if we already have a range visible? 
            // Just fitContent always for now when ITEM changes - how to detect Item Change? 
            // The parent component passes `data`.

            // Simplest fix for "When changing to other items... price difference... must move":
            // This implies that CURRENTLY we are NOT fitting content, or we are fitting but it's weird?
            // Actually currently we DO `chartRef.current?.timeScale().fitContent();` on every render.
            // This resets the X-axis (Time).
            // But the Y-axis (Price) auto-scales to visible Time Range by default in lightweight-charts.

            // If the user says "When changing items... price diff is large... have to move", 
            // it implies the Y-scale is NOT resetting or is stuck at old item's price range.
            // But lightweight-charts default `autoScale: true` on PriceScale should handle this IF the data is replaced.

            // Maybe we need to explicitely reset the price scale mode?
            chartRef.current?.priceScale('right').applyOptions({
                autoScale: true
            });

            // FORCE a fit content to ensure X and Y axes snap to the new item's data range.
            chartRef.current?.timeScale().fitContent();
        }

    }, [chartData, showTrend]);

    return (
        <div className="w-full h-full min-h-[400px] relative group animate-in fade-in duration-500">
            {/* Legend Overlay */}
            <div className="absolute top-3 left-3 z-20 pointer-events-none flex flex-col gap-1 bg-zinc-950/50 backdrop-blur-sm p-3 rounded-lg border border-zinc-800/50">
                {legendData ? (
                    <>
                        <div className="text-zinc-400 text-xs font-medium border-b border-zinc-800 pb-1 mb-1">{legendData.dateStr}</div>
                        <div className="flex gap-4 text-xs font-mono">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-green-500 font-bold">M Low: ${legendData.marketLow?.toLocaleString() ?? '-'}</span>
                                <span className="text-green-700">M Avg: ${legendData.marketAvg?.toLocaleString() ?? '-'}</span>
                                {showTrend && <span className="text-fuchsia-500">M Trd: ${legendData.marketMa?.toLocaleString() ?? '-'}</span>}
                            </div>
                            <div className="flex flex-col gap-0.5 border-l border-zinc-800 pl-4">
                                <span className="text-blue-500 font-bold">B Low: ${legendData.bazaarLow?.toLocaleString() ?? '-'}</span>
                                <span className="text-blue-700">B Avg: ${legendData.bazaarAvg?.toLocaleString() ?? '-'}</span>
                                {showTrend && <span className="text-orange-500">B Trd: ${legendData.bazaarMa?.toLocaleString() ?? '-'}</span>}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="text-zinc-500 text-xs">Hover to see values</div>
                )}
            </div>

            <div className="absolute top-2 right-16 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                <label className="flex items-center gap-2 bg-zinc-900/80 backdrop-blur px-3 py-1.5 rounded-full border border-zinc-700 cursor-pointer hover:border-zinc-500 transition-colors">
                    <input
                        type="checkbox"
                        checked={showTrend}
                        onChange={(e) => setShowTrend(e.target.checked)}
                        className="rounded border-zinc-600 bg-zinc-800 text-green-500 focus:ring-green-500 focus:ring-offset-zinc-900"
                    />
                    <span className="text-xs font-medium text-zinc-300">Show 24h Trend</span>
                </label>
            </div>
            <div ref={chartContainerRef} className="w-full h-full" />
        </div>
    );
}
