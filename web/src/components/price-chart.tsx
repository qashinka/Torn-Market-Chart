'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    Time,
    ColorType,
    HistogramData,
    LogicalRange,
    IPriceLine,
    CandlestickData,
    AreaData,
    MouseEventParams,
} from 'lightweight-charts';
import { PriceCandle } from '@/lib/api';
import { Maximize2, Minimize2, Trash2, Crosshair, PlusCircle, RotateCcw, TrendingUp, ArrowUpRight, MoveHorizontal, Minus } from 'lucide-react';

import { SMA, EMA, BollingerBands } from 'technicalindicators';

interface PriceChartProps {
    data: PriceCandle[];
    height?: number;
    isFullscreen?: boolean;
    onToggleFullscreen?: () => void;
}

type DrawingTool = 'none' | 'trendline' | 'ray' | 'extended' | 'horizontal';

interface DrawnLine {
    id: string;
    type: DrawingTool;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    color: string;
}

interface ChartDataPoint {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    change: number;
    isUp: boolean;
}

interface ChartContextMenuProps {
    x: number;
    y: number;
    price: number | null;
    onClose: () => void;
    onAddLine: (price: number) => void;
    onClearLines: () => void;
    onCopyPrice: (price: number) => void;
    onResetView: () => void;
}

function ChartContextMenu({ x, y, price, onClose, onAddLine, onClearLines, onCopyPrice, onResetView }: ChartContextMenuProps) {
    useEffect(() => {
        const handleClickOutside = () => onClose();
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [onClose]);

    return (
        <div
            className="fixed z-50 bg-[#1e222d] border border-[#2B2B43] rounded-md shadow-xl py-1 min-w-[180px]"
            style={{ top: y, left: x }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {price && (
                <>
                    <button
                        onClick={() => onAddLine(price)}
                        className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#2a2e39] flex items-center gap-2"
                    >
                        <PlusCircle className="w-3.5 h-3.5 text-[#2962FF]" />
                        Add Horizontal Line
                    </button>
                    <button
                        onClick={() => onCopyPrice(price)}
                        className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#2a2e39] flex items-center gap-2"
                    >
                        <Crosshair className="w-3.5 h-3.5 text-gray-400" />
                        Copy Price: {price.toLocaleString()}
                    </button>
                    <div className="h-px bg-[#2B2B43] my-1" />
                </>
            )}
            <button
                onClick={onResetView}
                className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#2a2e39] flex items-center gap-2"
            >
                <RotateCcw className="w-3.5 h-3.5 text-[#22c55e]" />
                Reset Chart View
            </button>
            <div className="h-px bg-[#2B2B43] my-1" />
            <button
                onClick={onClearLines}
                className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-[#2a2e39] flex items-center gap-2"
            >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All Drawings
            </button>
        </div>
    );
}

// Drawing Toolbar Component
function DrawingToolbar({ activeTool, onSelectTool }: { activeTool: DrawingTool; onSelectTool: (tool: DrawingTool) => void }) {
    const tools: { tool: DrawingTool; icon: React.ReactNode; label: string }[] = [
        { tool: 'trendline', icon: <TrendingUp className="w-4 h-4" />, label: 'Trendline' },
        { tool: 'ray', icon: <ArrowUpRight className="w-4 h-4" />, label: 'Ray' },
        { tool: 'extended', icon: <MoveHorizontal className="w-4 h-4" />, label: 'Extended Line' },
        { tool: 'horizontal', icon: <Minus className="w-4 h-4" />, label: 'Horizontal Line' },
    ];

    return (
        <div className="absolute top-14 left-2 z-20 flex flex-col gap-1 bg-[#1e222d]/90 backdrop-blur-sm p-1.5 rounded-lg border border-[#2B2B43]">
            {tools.map(({ tool, icon, label }) => (
                <button
                    key={tool}
                    onClick={() => onSelectTool(activeTool === tool ? 'none' : tool)}
                    className={`p-2 rounded transition-all ${activeTool === tool
                        ? 'bg-[#2962FF] text-white'
                        : 'text-gray-400 hover:bg-[#2a2e39] hover:text-gray-200'
                        }`}
                    title={label}
                >
                    {icon}
                </button>
            ))}
        </div>
    );
}

export function PriceChart({ data, height = 500, isFullscreen, onToggleFullscreen }: PriceChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Chart References
    const chartRef = useRef<IChartApi | null>(null);
    const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

    // Indicator Series References
    const smaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bbMiddleSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

    const visibleRangeRef = useRef<LogicalRange | null>(null);
    const isFirstLoadRef = useRef(true);
    const linesMapRef = useRef<Map<string, IPriceLine>>(new Map());

    const [chartType, setChartType] = useState<'candle' | 'line'>('candle');
    const [showSMA, setShowSMA] = useState(false);
    const [showEMA, setShowEMA] = useState(false);
    const [showBB, setShowBB] = useState(false);
    const [hoveredData, setHoveredData] = useState<ChartDataPoint | null>(null);

    // Derived state for display
    const displayData = useMemo(() => {
        if (hoveredData) return hoveredData;
        if (data.length > 0) {
            const last = data[data.length - 1];
            return {
                open: last.open, high: last.high, low: last.low, close: last.close,
                volume: last.volume || 0, change: ((last.close - last.open) / last.open) * 100, isUp: last.close >= last.open
            };
        }
        return null;
    }, [data, hoveredData]);

    // Interaction State
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; price: number | null; time: Time | null } | null>(null);
    const [priceLines, setPriceLines] = useState<Array<{ id: string; price: number; title: string; color: string }>>([]);

    // Drawing State
    const [activeTool, setActiveTool] = useState<DrawingTool>('none');
    const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
    const [currentMousePos, setCurrentMousePos] = useState<{ x: number; y: number } | null>(null);

    // --- Chart Initialization ---
    useEffect(() => {
        if (!containerRef.current) return;

        const chart = createChart(containerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#131722' },
                textColor: '#d1d5db',
            },
            grid: {
                vertLines: { color: '#1e222d' },
                horzLines: { color: '#1e222d' },
            },
            width: containerRef.current.clientWidth,
            height: height,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: '#2B2B43',
            },
            rightPriceScale: {
                borderColor: '#2B2B43',
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.1,
                },
            },
            crosshair: {
                mode: 1,
                vertLine: {
                    labelBackgroundColor: '#1f2937',
                    color: '#9ca3af',
                    style: 2,
                },
                horzLine: {
                    labelBackgroundColor: '#1f2937',
                    color: '#9ca3af',
                    style: 2,
                },
            },
        });

        chartRef.current = chart;

        // Create Volume Series (Always present)
        const volumeSeries = chart.addHistogramSeries({
            color: '#26a69a',
            priceFormat: { type: 'volume' },
            priceScaleId: '',
        });
        volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
        });
        volumeSeriesRef.current = volumeSeries;

        // Resize handler
        const resizeObserver = new ResizeObserver((entries) => {
            if (entries.length === 0 || !entries[0].target) return;
            const newRect = entries[0].contentRect;
            chart.applyOptions({ width: newRect.width, height: newRect.height });
        });
        resizeObserver.observe(containerRef.current);

        // Visible range handler
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (range) visibleRangeRef.current = range;
        });

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            mainSeriesRef.current = null;
            volumeSeriesRef.current = null;
            smaSeriesRef.current = null;
            emaSeriesRef.current = null;
            bbUpperSeriesRef.current = null;
            bbMiddleSeriesRef.current = null;
            bbLowerSeriesRef.current = null;
            isFirstLoadRef.current = true;
        };
    }, [height]);

    // --- Main Series Management (Candle/Line) ---
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;

        // Remove previous main series
        if (mainSeriesRef.current) {
            chart.removeSeries(mainSeriesRef.current);
            mainSeriesRef.current = null;
        }

        let mainSeries: ISeriesApi<'Candlestick'> | ISeriesApi<'Area'>;

        if (chartType === 'candle') {
            mainSeries = chart.addCandlestickSeries({
                upColor: '#089981',
                downColor: '#f23645',
                borderUpColor: '#089981',
                borderDownColor: '#f23645',
                wickUpColor: '#089981',
                wickDownColor: '#f23645',
            });
        } else {
            mainSeries = chart.addAreaSeries({
                lineColor: '#2962FF',
                topColor: 'rgba(41, 98, 255, 0.28)',
                bottomColor: 'rgba(41, 98, 255, 0.00)',
            });
        }
        mainSeriesRef.current = mainSeries;

    }, [chartType]);


    // --- Data Update Logic ---
    useEffect(() => {
        const chart = chartRef.current;
        const mainSeries = mainSeriesRef.current;
        const volumeSeries = volumeSeriesRef.current;

        if (!chart || !mainSeries || !volumeSeries || data.length === 0) return;

        const timezoneOffsetSeconds = new Date().getTimezoneOffset() * 60;

        // Process Data
        const chartData = data.map((d) => {
            const utcSeconds = new Date(d.time).getTime() / 1000;
            const time = (utcSeconds - timezoneOffsetSeconds) as Time;

            if (chartType === 'candle') {
                return { time, open: d.open, high: d.high, low: d.low, close: d.close };
            } else {
                return { time, value: d.avg_price || d.close };
            }
        });

        const volumeData = data.map((d) => {
            const utcSeconds = new Date(d.time).getTime() / 1000;
            const time = (utcSeconds - timezoneOffsetSeconds) as Time;
            const color = d.close >= d.open ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 54, 69, 0.5)';
            return { time, value: d.volume || 0, color };
        });

        // Update Series
        if (chartType === 'candle') {
            (mainSeries as ISeriesApi<'Candlestick'>).setData(chartData as CandlestickData<Time>[]);
        } else {
            (mainSeries as ISeriesApi<'Area'>).setData(chartData as AreaData<Time>[]);
        }
        volumeSeries.setData(volumeData as HistogramData<Time>[]);

        // Autoscale Logic (for Candle)
        if (chartType === 'candle') {
            mainSeries.applyOptions({
                autoscaleInfoProvider: () => {
                    const visibleRange = chart.timeScale().getVisibleLogicalRange();
                    if (!visibleRange) return null;

                    const from = Math.max(0, Math.floor(visibleRange.from));
                    const to = Math.min(data.length - 1, Math.ceil(visibleRange.to));

                    if (from > to || to < 0) return null;

                    const bodyPrices: number[] = [];
                    for (let i = from; i <= to; i++) {
                        if (data[i]) {
                            bodyPrices.push(data[i].open, data[i].close);
                        }
                    }

                    if (bodyPrices.length < 2) return null;

                    const sorted = [...bodyPrices].sort((a, b) => a - b);
                    const q1 = sorted[Math.floor(sorted.length * 0.25)];
                    const q3 = sorted[Math.floor(sorted.length * 0.75)];
                    const iqr = q3 - q1;
                    const lowerBound = q1 - 2 * iqr;
                    const upperBound = q3 + 2 * iqr;

                    const filteredPrices = bodyPrices.filter(p => p >= lowerBound && p <= upperBound);

                    if (filteredPrices.length === 0) {
                        const minPrice = Math.min(...bodyPrices);
                        const maxPrice = Math.max(...bodyPrices);
                        const padding = (maxPrice - minPrice) * 0.1;
                        return { priceRange: { minValue: minPrice - padding, maxValue: maxPrice + padding } };
                    }

                    const minPrice = Math.min(...filteredPrices);
                    const maxPrice = Math.max(...filteredPrices);
                    const padding = (maxPrice - minPrice) * 0.15;

                    return { priceRange: { minValue: minPrice - padding, maxValue: maxPrice + padding } };
                },
            });
        }

        // Restore View State
        if (isFirstLoadRef.current) {
            chart.timeScale().fitContent();
            isFirstLoadRef.current = false;
        } else if (visibleRangeRef.current) {
            // chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
        }

    }, [data, chartType]);

    // --- Crosshair Event Handling with Ref ---
    const dataRef = useRef(data);
    useEffect(() => { dataRef.current = data; }, [data]);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;

        const handleCrosshairMove = (param: MouseEventParams) => {
            if (param.time) {
                const currentData = dataRef.current;
                const timezoneOffsetSeconds = new Date().getTimezoneOffset() * 60;

                const index = currentData.findIndex(d => {
                    const utcSeconds = new Date(d.time).getTime() / 1000;
                    const localSeconds = utcSeconds - timezoneOffsetSeconds;
                    return (localSeconds as Time) === param.time;
                });

                if (index !== -1) {
                    const d = currentData[index];
                    setHoveredData({
                        open: d.open, high: d.high, low: d.low, close: d.close,
                        volume: d.volume || 0, change: ((d.close - d.open) / d.open) * 100, isUp: d.close >= d.open
                    });
                } else {
                    setHoveredData(null);
                }
            } else {
                setHoveredData(null);
            }
        };

        chart.subscribeCrosshairMove(handleCrosshairMove);
        return () => chart.unsubscribeCrosshairMove(handleCrosshairMove);
    }, []);


    // --- Indicators Management ---
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || data.length === 0) return;

        const closePrices = data.map(d => d.close);
        const timezoneOffsetSeconds = new Date().getTimezoneOffset() * 60;
        const times = data.map(d => {
            const utcSeconds = new Date(d.time).getTime() / 1000;
            return (utcSeconds - timezoneOffsetSeconds) as Time;
        });

        // SMA
        if (showSMA) {
            if (!smaSeriesRef.current) {
                smaSeriesRef.current = chart.addLineSeries({
                    color: '#2962FF', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
                });
            }
            const smaPeriod = 20;
            const smaData = SMA.calculate({ period: smaPeriod, values: closePrices });
            const validSmaData = smaData.map((val, i) => ({ time: times[i + (smaPeriod - 1)], value: val }));
            smaSeriesRef.current.setData(validSmaData);
        } else if (smaSeriesRef.current) {
            chart.removeSeries(smaSeriesRef.current);
            smaSeriesRef.current = null;
        }

        // EMA
        if (showEMA) {
            if (!emaSeriesRef.current) {
                emaSeriesRef.current = chart.addLineSeries({
                    color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
                });
            }
            const emaPeriod = 10;
            const emaData = EMA.calculate({ period: emaPeriod, values: closePrices });
            const validEmaData = emaData.map((val, i) => ({ time: times[i + (emaPeriod - 1)], value: val }));
            emaSeriesRef.current.setData(validEmaData);
        } else if (emaSeriesRef.current) {
            chart.removeSeries(emaSeriesRef.current);
            emaSeriesRef.current = null;
        }

        // Bollinger Bands
        if (showBB) {
            if (!bbUpperSeriesRef.current) {
                bbUpperSeriesRef.current = chart.addLineSeries({ color: 'rgba(76, 175, 80, 0.5)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
                bbMiddleSeriesRef.current = chart.addLineSeries({ color: 'rgba(76, 175, 80, 0.5)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
                bbLowerSeriesRef.current = chart.addLineSeries({ color: 'rgba(76, 175, 80, 0.5)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            }

            const period = 20;
            const stdDev = 2;
            const bbResult = BollingerBands.calculate({ period, values: closePrices, stdDev });

            const validDataUpper = bbResult.map((val, i) => ({ time: times[i + (period - 1)], value: val.upper }));
            const validDataMiddle = bbResult.map((val, i) => ({ time: times[i + (period - 1)], value: val.middle }));
            const validDataLower = bbResult.map((val, i) => ({ time: times[i + (period - 1)], value: val.lower }));

            bbUpperSeriesRef.current.setData(validDataUpper);
            bbMiddleSeriesRef.current.setData(validDataMiddle);
            bbLowerSeriesRef.current.setData(validDataLower);

        } else if (bbUpperSeriesRef.current) {
            chart.removeSeries(bbUpperSeriesRef.current);
            chart.removeSeries(bbMiddleSeriesRef.current!);
            chart.removeSeries(bbLowerSeriesRef.current!);
            bbUpperSeriesRef.current = null;
            bbMiddleSeriesRef.current = null;
            bbLowerSeriesRef.current = null;
        }

    }, [data, showSMA, showEMA, showBB]);


    // --- Price Lines Synchronization ---
    useEffect(() => {
        if (!mainSeriesRef.current) return;
        const series = mainSeriesRef.current;
        const map = linesMapRef.current;

        // Add new lines
        priceLines.forEach(line => {
            if (!map.has(line.id)) {
                const priceLine = series.createPriceLine({
                    price: line.price, color: line.color, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: line.title,
                });
                map.set(line.id, priceLine);
            }
        });

        // Remove old lines
        const currentIds = new Set(priceLines.map(l => l.id));
        map.forEach((line, id) => {
            if (!currentIds.has(id)) {
                series.removePriceLine(line);
                map.delete(id);
            }
        });

    }, [priceLines, chartType]);

    // Effect to clear lines map when chart type changes (because series is destroyed)
    useEffect(() => {
        linesMapRef.current.clear();
    }, [chartType]);


    // --- Canvas Drawing ---
    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawnLines.forEach(line => {
            ctx.beginPath();
            ctx.strokeStyle = line.color;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);

            if (line.type === 'trendline') {
                ctx.moveTo(line.startX, line.startY);
                ctx.lineTo(line.endX, line.endY);
            } else if (line.type === 'ray') {
                const dx = line.endX - line.startX;
                const dy = line.endY - line.startY;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 0) {
                    const nx = dx / len;
                    const ny = dy / len;
                    const extendedX = line.startX + nx * 2000;
                    const extendedY = line.startY + ny * 2000;
                    ctx.moveTo(line.startX, line.startY);
                    ctx.lineTo(extendedX, extendedY);
                }
            } else if (line.type === 'extended') {
                const dx = line.endX - line.startX;
                const dy = line.endY - line.startY;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 0) {
                    const nx = dx / len;
                    const ny = dy / len;
                    ctx.moveTo(line.startX - nx * 2000, line.startY - ny * 2000);
                    ctx.lineTo(line.startX + nx * 2000, line.startY + ny * 2000);
                }
            } else if (line.type === 'horizontal') {
                ctx.moveTo(0, line.startY);
                ctx.lineTo(canvas.width, line.startY);
            }
            ctx.stroke();
        });

        if (isDrawing && drawStart && currentMousePos) {
            ctx.beginPath();
            ctx.strokeStyle = '#2962FF';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);

            if (activeTool === 'horizontal') {
                ctx.moveTo(0, drawStart.y);
                ctx.lineTo(canvas.width, drawStart.y);
            } else if (activeTool === 'ray') {
                const dx = currentMousePos.x - drawStart.x;
                const dy = currentMousePos.y - drawStart.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 0) {
                    const nx = dx / len;
                    const ny = dy / len;
                    ctx.moveTo(drawStart.x, drawStart.y);
                    ctx.lineTo(drawStart.x + nx * 2000, drawStart.y + ny * 2000);
                }
            } else if (activeTool === 'extended') {
                const dx = currentMousePos.x - drawStart.x;
                const dy = currentMousePos.y - drawStart.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 0) {
                    const nx = dx / len;
                    const ny = dy / len;
                    ctx.moveTo(drawStart.x - nx * 2000, drawStart.y - ny * 2000);
                    ctx.lineTo(drawStart.x + nx * 2000, drawStart.y + ny * 2000);
                }
            } else {
                ctx.moveTo(drawStart.x, drawStart.y);
                ctx.lineTo(currentMousePos.x, currentMousePos.y);
            }
            ctx.stroke();
        }
    }, [drawnLines, isDrawing, drawStart, currentMousePos, activeTool]);

    useEffect(() => { drawCanvas(); }, [drawCanvas]);
    useEffect(() => {
        const resizeCanvas = () => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            if (!canvas || !container) return;
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            drawCanvas();
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        return () => window.removeEventListener('resize', resizeCanvas);
    }, [drawCanvas]);

    // Context Menu Handlers
    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        if (!containerRef.current || !mainSeriesRef.current || !chartRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const price = mainSeriesRef.current.coordinateToPrice(y);
        const time = chartRef.current.timeScale().coordinateToTime(x);

        if (price !== null) {
            setContextMenu({ x: e.clientX, y: e.clientY, price, time });
        }
    };

    const addHorizontalLine = (price: number) => {
        const newLine = { id: Math.random().toString(36).substr(2, 9), price, title: 'Manual Level', color: '#2962FF' };
        setPriceLines(prev => [...prev, newLine]);
        setContextMenu(null);
    };

    const clearLines = () => {
        setPriceLines([]);
        setDrawnLines([]);
        setContextMenu(null);
    };

    const copyPrice = (price: number) => {
        navigator.clipboard.writeText(price.toFixed(2));
        setContextMenu(null);
    };

    const resetView = () => {
        if (chartRef.current) {
            chartRef.current.timeScale().fitContent();
            visibleRangeRef.current = null;
        }
        setContextMenu(null);
    };

    // Drawing Mouse Handlers
    const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (activeTool === 'none') return;
        e.preventDefault();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (activeTool === 'horizontal') {
            const newLine: DrawnLine = {
                id: Math.random().toString(36).substr(2, 9),
                type: 'horizontal',
                startX: 0, startY: y, endX: rect.width, endY: y,
                color: '#f59e0b',
            };
            setDrawnLines(prev => [...prev, newLine]);
            return;
        }
        setIsDrawing(true);
        setDrawStart({ x, y });
    };

    const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing || !drawStart) return;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setCurrentMousePos({ x, y });
    };

    const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing || !drawStart || activeTool === 'none') return;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const newLine: DrawnLine = {
            id: Math.random().toString(36).substr(2, 9),
            type: activeTool,
            startX: drawStart.x, startY: drawStart.y,
            endX: x, endY: y,
            color: '#f59e0b',
        };
        setDrawnLines(prev => [...prev, newLine]);
        setIsDrawing(false);
        setDrawStart(null);
        setCurrentMousePos(null);
    };

    return (
        <div className={`w-full h-full bg-[#131722] p-3 rounded-xl border border-[#2B2B43] flex flex-col gap-2 shadow-lg ${isFullscreen ? 'rounded-none border-none' : ''}`}>
            {/* Toolbar */}
            <div className="flex flex-wrap gap-4 justify-between items-center text-gray-300 pb-2 border-b border-[#2B2B43]">
                <div className="flex gap-3 items-center">
                    <span className="font-bold text-[#e1e1e1] tracking-wide text-sm">TORN-CHART</span>
                    <div className="w-px h-4 bg-[#2B2B43]" />
                    <div className="flex bg-[#1e222d] rounded-md p-0.5">
                        <button
                            onClick={() => setChartType('candle')}
                            className={`p-1.5 rounded text-xs font-medium transition-all ${chartType === 'candle' ? 'bg-[#2a2e39] text-[#d1d5db] shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                            title="Candles"
                        >
                            Candles
                        </button>
                        <button
                            onClick={() => setChartType('line')}
                            className={`p-1.5 rounded text-xs font-medium transition-all ${chartType === 'line' ? 'bg-[#2a2e39] text-[#d1d5db] shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                            title="Line"
                        >
                            Line
                        </button>
                    </div>
                </div>

                <div className="flex gap-2 items-center">
                    <button
                        onClick={() => setShowSMA(!showSMA)}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${showSMA ? 'bg-[#2962FF]/20 text-[#2962FF]' : 'text-gray-500 hover:bg-[#2a2e39] hover:text-gray-300'}`}
                    >
                        SMA 20
                    </button>
                    <button
                        onClick={() => setShowEMA(!showEMA)}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${showEMA ? 'bg-[#f59e0b]/20 text-[#f59e0b]' : 'text-gray-500 hover:bg-[#2a2e39] hover:text-gray-300'}`}
                    >
                        EMA 10
                    </button>
                    <button
                        onClick={() => setShowBB(!showBB)}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${showBB ? 'bg-[#4caf50]/20 text-[#4caf50]' : 'text-gray-500 hover:bg-[#2a2e39] hover:text-gray-300'}`}
                    >
                        BB 20,2
                    </button>

                    {onToggleFullscreen && (
                        <>
                            <div className="w-px h-4 bg-[#2B2B43] mx-1" />
                            <button
                                onClick={onToggleFullscreen}
                                className="p-1.5 text-gray-400 hover:text-white hover:bg-[#2a2e39] rounded transition-colors"
                                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                            >
                                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Legend Overlay & Chart */}
            <div className="relative w-full h-full flex-1" onContextMenu={handleContextMenu}>
                {/* Drawing Toolbar */}
                <DrawingToolbar activeTool={activeTool} onSelectTool={setActiveTool} />

                {/* Legend */}
                {displayData && (
                    <div className="absolute top-2 left-16 z-10 font-mono text-xs text-[#d1d5db] pointer-events-none select-none flex flex-col gap-0.5 bg-[#131722]/60 backdrop-blur-sm p-1.5 rounded border border-[#2B2B43]/50">
                        <div className="flex gap-4">
                            <span className="text-gray-400">O <span className={displayData.isUp ? 'text-[#089981]' : 'text-[#f23645]'}>{displayData.open?.toLocaleString()}</span></span>
                            <span className="text-gray-400">H <span className={displayData.isUp ? 'text-[#089981]' : 'text-[#f23645]'}>{displayData.high?.toLocaleString()}</span></span>
                            <span className="text-gray-400">L <span className={displayData.isUp ? 'text-[#089981]' : 'text-[#f23645]'}>{displayData.low?.toLocaleString()}</span></span>
                            <span className="text-gray-400">C <span className={displayData.isUp ? 'text-[#089981]' : 'text-[#f23645]'}>{displayData.close?.toLocaleString()}</span></span>
                        </div>
                        <div className="flex gap-4">
                            <span className="text-gray-400">Vol <span className="text-[#e1e1e1]">{displayData.volume?.toLocaleString()}</span></span>
                            <span className={`${displayData.change >= 0 ? 'text-[#089981]' : 'text-[#f23645]'}`}>
                                {displayData.change >= 0 ? '+' : ''}{displayData.change.toFixed(2)}%
                            </span>
                        </div>
                    </div>
                )}

                {/* Chart Container */}
                <div ref={containerRef} className="w-full h-full rounded overflow-hidden" />

                {/* Drawing Canvas Overlay */}
                <canvas
                    ref={canvasRef}
                    className={`absolute inset-0 z-10 ${activeTool !== 'none' ? 'cursor-crosshair' : 'pointer-events-none'}`}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={() => {
                        if (isDrawing) {
                            setIsDrawing(false);
                            setDrawStart(null);
                            setCurrentMousePos(null);
                        }
                    }}
                />

                {/* Active Tool Indicator */}
                {activeTool !== 'none' && (
                    <div className="absolute bottom-2 left-2 z-20 px-2 py-1 bg-[#2962FF] text-white text-xs rounded flex items-center gap-1.5">
                        <span>Drawing: {activeTool.charAt(0).toUpperCase() + activeTool.slice(1)}</span>
                        <button
                            onClick={() => setActiveTool('none')}
                            className="ml-1 hover:bg-white/20 rounded p-0.5"
                            title="Cancel"
                        >
                            ✕
                        </button>
                    </div>
                )}

                {/* Context Menu Overlay */}
                {contextMenu && (
                    <ChartContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        price={contextMenu.price}
                        onClose={() => setContextMenu(null)}
                        onAddLine={addHorizontalLine}
                        onClearLines={clearLines}
                        onCopyPrice={copyPrice}
                        onResetView={resetView}
                    />
                )}
            </div>
        </div>
    );
}
