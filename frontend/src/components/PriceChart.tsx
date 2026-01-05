import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, Time, LineStyle, LineSeries, CandlestickSeries } from 'lightweight-charts';
import { PriceData, PriceCandle, PricePoint, getHistory } from '@/lib/api'; // Ensure getHistory is imported
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

export interface PriceChartProps {
    itemId: number;
    // Initial data might be passed, but we prefer internal fetching for pagination control?
    // Or parent manages data? If we want infinite scroll, component managing data is easier OR parent exposes loadMore.
    // Let's assume component fetches data for now to handle complex state locally.
    // But existing app passed `data`. Let's switch to internal fetching if we can, or just ignore props?
    // The previous implementation used `data` prop.
    // To minimize refactoring of parent, maybe we accept `itemId` and fetch ourselves.
}

type Timeframe = 'raw' | '15m' | '30m' | '1h' | '4h' | '12h' | '1d' | '1w';
type ChartType = 'candle' | 'line';

interface VisibilityState {
    market: boolean;
    bazaar: boolean;
    marketAvg: boolean;
    bazaarAvg: boolean;
}

export function PriceChart({ itemId }: PriceChartProps) {
    // State
    const [timeframe, setTimeframe] = useState<Timeframe>('1h');
    const [chartType, setChartType] = useState<ChartType>('candle');
    const [visibility, setVisibility] = useState<VisibilityState>({
        market: true,
        bazaar: true, // Default to true, let user hide if cluttered
        marketAvg: true,
        bazaarAvg: true,
    });

    const [data, setData] = useState<PriceData[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    // Series Refs
    const seriesRefs = useRef<{
        marketCandle?: ISeriesApi<"Candlestick">;
        bazaarCandle?: ISeriesApi<"Candlestick">;
        marketLine?: ISeriesApi<"Line">; // or Area
        bazaarLine?: ISeriesApi<"Line">;
        marketAvg?: ISeriesApi<"Line">;
        bazaarAvg?: ISeriesApi<"Line">;
    }>({});

    const [legendData, setLegendData] = useState<any>(null);

    // Initial Load
    useEffect(() => {
        setData([]); // Clear old data immediately
        setHasMore(true);
        setLegendData(null);
        setLoading(false); // Force reset loading state in case previous fetch was stuck

        if (chartRef.current) {
            chartRef.current.priceScale('right').applyOptions({
                autoScale: true,
            });
            chartRef.current.timeScale().resetTimeScale();
        }

        loadData(true);
    }, [itemId, timeframe]);

    // Polling for latest data
    useEffect(() => {
        const interval = setInterval(async () => {
            if (loading || data.length === 0) return;

            // Get last timestamp
            // data is sorted ascending (oldest first)? 
            // Previous loadData prepends, so data[0] is oldest?
            // "return [...filteredNew, ...prev]" suggests new data (older) is at [0].
            // Wait. "filteredNew = newData.filter(d < existingStart)". 
            // This implies `newData` is OLDER history.
            // So `data` is sorted Ascending (Index 0 = Oldest, Index N = Newest)?
            // OR Index 0 = Newest?
            // "return [...filteredNew, ...prev]"
            // If `prev` is [Current], and we load older, we want [Older, Current].
            // So `prev` is remaining at the END of the array.
            // So `data[data.length - 1]` is the NEWEST data point.

            const lastPoint = data[data.length - 1];
            if (!lastPoint) return;

            try {
                // Fetch NEWER data (start_date = lastPoint.timestamp)
                // We assume getHistory supports start_date/end_date inclusive/exclusive.
                // Usually APIs are inclusive.
                // We just want latest "updates".
                // If we ask for last 1 day, we get a lot.
                // We should ask for "start_date" > lastPoint.timestamp.
                // But our API takes `start_date` string.
                const nextStart = new Date(new Date(lastPoint.timestamp).getTime() + 1000).toISOString();

                const pollParams: any = {
                    interval: timeframe,
                    start_date: nextStart
                };

                // We use getHistory directly
                const newPoints = await getHistory(itemId, pollParams);

                if (newPoints && newPoints.length > 0) {
                    setData(prev => {
                        // Merge logic: Append to end
                        // Ensure no dupes (though start_date should handle it)
                        // Also, lightweight-charts update logic?
                        // We update state, and the "Effect that updates series" handles it?
                        // We need to verify if there's an Effect that watches `data`.
                        // Line 345+ usually has `useEffect(() => { ... update series ... }, [data])`.

                        // Just append
                        return [...prev, ...newPoints];
                    });
                }
            } catch (e) {
                console.error("Polling failed", e);
            }
        }, 60000); // Poll every 60s

        return () => clearInterval(interval);
    }, [data, itemId, timeframe, loading]);

    // Cleanup: we need to ensure `data` in dependency doesn't cause infinite re-render loop if limits are hit.
    // Interval closure captures `data`.
    // Actually, `setInterval` with `data` dependency will reset interval every time data changes.
    // This is fine, effectively "debounce" polling.
    // But verification of `data` order is crucial.

    // loadData logic: 
    // const existingStart = prev.length > 0 ? prev[0].timestamp : null;
    // ... return [...filteredNew, ...prev];
    // Yes, `prev` is at the end. New loaded history is prepended.
    // So data is ASCENDING time.

    const loadData = async (reset: boolean = false, endDate?: string) => {
        if (loading) return;
        setLoading(true);
        try {
            // Determine params
            const params: any = { interval: timeframe };
            if (reset) {
                // Initial load: Last 7 days? Or just default days=7
                params.days = 7;
            } else {
                // Load more: End date = earliest current timestamp
                if (endDate) params.end_date = endDate;
                // How far back? Let's verify backend logic. 
                // If we pass end_date, we need start_date or days?
                // Backend: if start_date missed, limit_start = now - days. this is bad for scrolling back.
                // We should pass `days` (chunk size) + `end_date`.
                params.days = 7; // Load 7 days chunks
            }

            const newData = await getHistory(itemId, params);

            if (newData.length === 0) {
                setHasMore(false);
            } else {
                setData(prev => {
                    if (reset) return newData;
                    // Prepend logic
                    // Ensure no duplicates? 
                    // Simple check: Filter out any items >= existing start
                    const existingStart = prev.length > 0 ? prev[0].timestamp : null;
                    if (!existingStart) return newData;
                    const filteredNew = newData.filter(d => new Date(d.timestamp).getTime() < new Date(existingStart).getTime());
                    return [...filteredNew, ...prev];
                });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // Chart Initialization
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#71717a',
                fontFamily: "'Inter', sans-serif",
            },
            grid: {
                vertLines: { color: '#27272a' },
                horzLines: { color: '#27272a' },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: '#27272a',
            },
            rightPriceScale: {
                borderColor: '#27272a',
                autoScale: true,
            },
            crosshair: {
                mode: 1, // Magnet
            },
        });

        chartRef.current = chart;

        // Create Series
        // We recreate series when type changes OR we just manage visibility?
        // Managing visibility is better. Create ALL potentially needed series?
        // Changing data format between Candle/Line is tricky.
        // Let's create proper series based on current "chartType" state in a separate effect?
        // Or create all and manage data?

        // Simpler: Identify which series we need based on chartType and create them.



        // Let's just create chart once and manage series in the Data Effect.

        // Crosshair
        chart.subscribeCrosshairMove(param => {
            if (
                param.point === undefined ||
                !param.time ||
                param.point.x < 0 ||
                param.point.x > chartContainerRef.current!.clientWidth ||
                param.point.y < 0 ||
                param.point.y > chartContainerRef.current!.clientHeight
            ) {
                setLegendData(null);
                return;
            }

            // Helper to get value
            const getValue = (series: ISeriesApi<any> | undefined): any => {
                if (!series) return undefined;
                const d = param.seriesData.get(series);
                if (d === undefined || d === null) return undefined;
                // Candlestick: { time, open, high, low, close }
                if (typeof d === 'object' && 'close' in d) return d;
                // Line/Area: { time, value } or number
                if (typeof d === 'object' && 'value' in d) return (d as any).value;
                if (typeof d === 'number') return d;
                return undefined;
            };

            const mkVal = getValue(seriesRefs.current.marketCandle || seriesRefs.current.marketLine);
            const bzVal = getValue(seriesRefs.current.bazaarCandle || seriesRefs.current.bazaarLine);
            const mkAvg = getValue(seriesRefs.current.marketAvg);
            const bzAvg = getValue(seriesRefs.current.bazaarAvg);

            const date = new Date((param.time as number) * 1000);
            const dateStr = date.toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo',
                month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            setLegendData({
                dateStr,
                market: mkVal,
                bazaar: bzVal,
                marketAvg: mkAvg,
                bazaarAvg: bzAvg
            });
        });

        // Infinite Scroll
        chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (range && range.from < 0 && !loading && hasMore) { // Close to start
                // Debounce?
                // Simple trigger:
                // fetchMore();
                // We need access to current oldest data timestamp
                // Ref to current data?
                // Let's implement this carefully. use a ref for `data`?
            }
        });

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
    }, []);

    // 3. Manage Series Instances (Create/Delete based on Type/Visibility)
    useEffect(() => {
        if (!chartRef.current) return;
        const chart = chartRef.current;

        // Helper to ensure series exists
        const ensureSeries = (
            key: keyof typeof seriesRefs.current,
            type: 'Candlestick' | 'Line',
            options: any,
            isVisible: boolean
        ) => {
            let series = seriesRefs.current[key];

            // Should we recreate if type mismatches? 
            // The refs handle specific types. 
            // If we switch chartType (Candle->Line), we MUST remove Candle series and create Line series.
            // But we stored them in specific keys: marketCandle, marketLine.

            // Logic:
            // If visible:
            //   Check if we have the *correct* series for the current mode.
            //   If yes, good. If no, create it.
            //   Also ensure the *other* mode's series is removed.

            if (isVisible) {
                // Remove opposite type if exists (e.g. if showing Candle, remove Line)
                // Actually my refs are specific: marketCandle vs marketLine.
                // So current key is specific. Just create if missing.
                if (!series) {
                    if (type === 'Candlestick') {
                        series = chart.addSeries(CandlestickSeries, options) as any;
                    } else {
                        series = chart.addSeries(LineSeries, options) as any;
                    }
                    seriesRefs.current[key] = series as any; // forceful assignment
                }
            } else {
                // If not visible, remove it
                if (series) {
                    chart.removeSeries(series);
                    delete seriesRefs.current[key];
                }
            }
        };

        // Determine which series should exist
        const showCandles = chartType === 'candle' && timeframe !== 'raw';

        // Market
        ensureSeries('marketCandle', 'Candlestick', {
            upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444'
        }, visibility.market && showCandles);

        ensureSeries('marketLine', 'Line', {
            color: '#22c55e', lineWidth: 2
        }, visibility.market && !showCandles);

        // Bazaar
        ensureSeries('bazaarCandle', 'Candlestick', {
            upColor: '#3b82f6', downColor: '#f97316', borderVisible: false, wickUpColor: '#3b82f6', wickDownColor: '#f97316'
        }, visibility.bazaar && showCandles);

        ensureSeries('bazaarLine', 'Line', {
            color: '#3b82f6', lineWidth: 2
        }, visibility.bazaar && !showCandles);

        // Averages (Always Line)
        ensureSeries('marketAvg', 'Line', {
            color: '#4ade80', lineWidth: 2, lineStyle: LineStyle.Dashed
        }, visibility.marketAvg);

        ensureSeries('bazaarAvg', 'Line', {
            color: '#60a5fa', lineWidth: 2, lineStyle: LineStyle.Dashed
        }, visibility.bazaarAvg);

    }, [chartType, visibility, timeframe]);


    // 4. Update Data (Separate Effect)
    // 4. Update Data (Separate Effect)
    useEffect(() => {
        if (!chartRef.current || data.length === 0) return;

        const toTime = (ts: string) => (new Date(ts).getTime() / 1000) as Time;

        // Prepare datasets
        const update = (key: keyof typeof seriesRefs.current, transformer: (d: any) => any) => {
            const s = seriesRefs.current[key];
            if (s) {
                // Filter out nulls (which represent invalid ranges with 0 price)
                const validData = data.map(transformer).filter((d): d is any => d !== null);
                s.setData(validData);
            }
        };

        // Market Candle
        update('marketCandle', d => {
            const o = (d as PriceCandle).market_open ?? 0;
            const h = (d as PriceCandle).market_high ?? 0;
            const l = (d as PriceCandle).market_low ?? 0;
            const c = (d as PriceCandle).market_close ?? 0;
            // Strict filter: If ANY component is 0/invalid, skip.
            if (o <= 0 || h <= 0 || l <= 0 || c <= 0) return null;
            return {
                time: toTime(d.timestamp),
                open: o, high: h, low: l, close: c,
            };
        });

        // Market Line
        update('marketLine', d => {
            const val = (d as PriceCandle).market_close ?? (d as PricePoint).market_price ?? 0;
            if (val <= 0) return null;
            return {
                time: toTime(d.timestamp),
                value: val
            };
        });

        // Bazaar Candle
        update('bazaarCandle', d => {
            const o = (d as PriceCandle).bazaar_open ?? 0;
            const h = (d as PriceCandle).bazaar_high ?? 0;
            const l = (d as PriceCandle).bazaar_low ?? 0;
            const c = (d as PriceCandle).bazaar_close ?? 0;
            if (o <= 0 || h <= 0 || l <= 0 || c <= 0) return null;
            return {
                time: toTime(d.timestamp),
                open: o, high: h, low: l, close: c,
            };
        });

        // Bazaar Line
        update('bazaarLine', d => {
            const val = (d as PriceCandle).bazaar_close ?? (d as PricePoint).bazaar_price ?? 0;
            if (val <= 0) return null;
            return {
                time: toTime(d.timestamp),
                value: val
            };
        });

        // Averages
        update('marketAvg', d => {
            const val = (d as PriceCandle).market_avg ?? (d as PricePoint).market_price_avg ?? 0;
            if (val <= 0) return null;
            return {
                time: toTime(d.timestamp),
                value: val
            };
        });

        update('bazaarAvg', d => {
            const val = (d as PriceCandle).bazaar_avg ?? (d as PricePoint).bazaar_price_avg ?? 0;
            if (val <= 0) return null;
            return {
                time: toTime(d.timestamp),
                value: val
            };
        });

    }, [data, chartType, visibility, timeframe]); // Data update triggers setData, not recreation

    // Infinite Scroll Ref & Handler
    // We need to access current `data` inside listener without re-binding.
    const earliestDateRef = useRef<string | null>(null);
    useEffect(() => {
        if (data.length > 0) earliestDateRef.current = data[0].timestamp;
    }, [data]);

    const isLoadingRef = useRef(loading);
    useEffect(() => { isLoadingRef.current = loading; }, [loading]);

    useEffect(() => {
        if (!chartRef.current) return;
        const handleRange = (range: any) => {
            if (range && range.from < 5 && !isLoadingRef.current && hasMore) { // range.from is logical index
                // Fetch more!
                // We need to know 'endDate' = earliestDateRef.current
                if (earliestDateRef.current) {
                    loadData(false, earliestDateRef.current);
                }
            }
        };
        chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(handleRange);
        return () => {
            // Unsub? lightweight-charts doesn't handle unsub well if chart destroyed?
        };
    }, [hasMore]); // Re-bind if hasMore changes? 

    return (
        <div className="flex flex-col w-full h-full relative group gap-2">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-2 bg-zinc-900/50 rounded-lg border border-zinc-800">
                {/* Timeframe */}
                <div className="flex gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800">
                    {(['raw', '15m', '30m', '1h', '4h', '12h', '1d', '1w'] as Timeframe[]).map(tf => (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={clsx(
                                "px-3 py-1 text-xs font-medium rounded transition-colors",
                                timeframe === tf ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                            )}
                        >
                            {tf.toUpperCase()}
                        </button>
                    ))}
                </div>

                {/* Chart Type */}
                <div className="flex gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800">
                    <button
                        onClick={() => setChartType('candle')}
                        disabled={timeframe === 'raw'}
                        className={clsx(
                            "px-3 py-1 text-xs font-medium rounded transition-colors",
                            chartType === 'candle' ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300",
                            timeframe === 'raw' && "opacity-50 cursor-not-allowed"
                        )}
                        title={timeframe === 'raw' ? "Aggregated view required" : "Candlestick"}
                    >
                        Candles
                    </button>
                    <button
                        onClick={() => setChartType('line')}
                        className={clsx(
                            "px-3 py-1 text-xs font-medium rounded transition-colors",
                            chartType === 'line' ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                        )}
                    >
                        Line
                    </button>
                </div>

                {/* Visibility Toggles */}
                <div className="flex items-center gap-3">
                    <Toggle color="text-green-500" label="Market" checked={visibility.market} onChange={c => setVisibility(v => ({ ...v, market: c }))} />
                    <Toggle color="text-green-400" label="M Avg" checked={visibility.marketAvg} onChange={c => setVisibility(v => ({ ...v, marketAvg: c }))} />
                    <div className="w-px h-4 bg-zinc-800 mx-1" />
                    <Toggle color="text-blue-500" label="Bazaar" checked={visibility.bazaar} onChange={c => setVisibility(v => ({ ...v, bazaar: c }))} />
                    <Toggle color="text-blue-400" label="B Avg" checked={visibility.bazaarAvg} onChange={c => setVisibility(v => ({ ...v, bazaarAvg: c }))} />
                </div>
            </div>

            {/* Chart Area */}
            <div className="relative flex-1 min-h-0 w-full rounded-lg border border-zinc-800 overflow-hidden">
                {/* Legend Overlay */}
                <div className="absolute top-3 left-3 z-20 pointer-events-none flex flex-col gap-1 bg-zinc-950/50 backdrop-blur-sm p-3 rounded-lg border border-zinc-800/50 transition-opacity opacity-0 group-hover:opacity-100">
                    {legendData ? (
                        <>
                            <div className="text-zinc-400 text-xs font-medium border-b border-zinc-800 pb-1 mb-1">{legendData.dateStr}</div>
                            <div className="flex gap-4 text-xs font-mono">
                                <div className="flex flex-col gap-0.5">
                                    <div className="text-green-500 font-bold flex items-center gap-2">
                                        <span>Mkt:</span>
                                        {typeof legendData.market === 'object' ? (
                                            <span className={clsx(legendData.market.close >= legendData.market.open ? "text-green-500" : "text-red-500")}>
                                                {legendData.market.close?.toLocaleString()}
                                                <span className="text-zinc-600 font-normal ml-1">
                                                    (H:{legendData.market.high} L:{legendData.market.low})
                                                </span>
                                            </span>
                                        ) : (
                                            <span>{legendData.market?.toLocaleString() ?? '-'}</span>
                                        )}
                                    </div>
                                    <span className="text-green-700">Avg: {legendData.marketAvg?.toLocaleString() ?? '-'}</span>
                                </div>
                                <div className="flex flex-col gap-0.5 border-l border-zinc-800 pl-4">
                                    <div className="text-blue-500 font-bold flex items-center gap-2">
                                        <span>Baz:</span>
                                        {typeof legendData.bazaar === 'object' ? (
                                            <span className={clsx(legendData.bazaar.close >= legendData.bazaar.open ? "text-blue-500" : "text-orange-500")}>
                                                {legendData.bazaar.close?.toLocaleString()}
                                            </span>
                                        ) : (
                                            <span>{legendData.bazaar?.toLocaleString() ?? '-'}</span>
                                        )}
                                    </div>
                                    <span className="text-blue-700">Avg: {legendData.bazaarAvg?.toLocaleString() ?? '-'}</span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="text-zinc-500 text-xs">Hover to see values</div>
                    )}
                </div>

                <div ref={chartContainerRef} className="w-full h-full" />
                {loading && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-zinc-900/80 px-3 py-1 rounded-full flex items-center gap-2 text-xs text-zinc-300 border border-zinc-700">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Loading history...
                    </div>
                )}
            </div>
        </div>
    );
}

function Toggle({ label, color, checked, onChange }: { label: string, color: string, checked: boolean, onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-center gap-1.5 cursor-pointer select-none group">
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="hidden" />
            <div className={clsx("w-3 h-3 rounded transition-colors border", checked ? "bg-current border-current" : "border-zinc-600 bg-transparent", color)} />
            <span className={clsx("text-xs font-medium transition-colors", checked ? "text-zinc-300" : "text-zinc-600")}>{label}</span>
        </label>
    );
}

