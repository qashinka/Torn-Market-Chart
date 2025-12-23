import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';

import { PriceChart } from './PriceChart';
import { AutocompleteInput } from './AutocompleteInput';
import { OrderBookButton } from './OrderBookButton';
import { getItems, getHistory, Item, PricePoint } from '@/lib/api';
import { calculateMovingAverage } from '@/lib/stats';

export function Dashboard() {
    const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
    // Store temporarily selected item object for display if not in the tracked list
    const [temporaryItem, setTemporaryItem] = useState<Item | null>(null);

    const { data: items, isLoading } = useQuery<Item[]>({
        queryKey: ['items'],
        queryFn: getItems
    });

    const { data: history } = useQuery<PricePoint[]>({
        queryKey: ['history', selectedItemId],
        queryFn: () => getHistory(selectedItemId!),
        enabled: !!selectedItemId
    });

    const enrichedHistory = useMemo(() => {
        if (!history) return undefined;
        return calculateMovingAverage(history, 24);
    }, [history]);

    const latestPoint = enrichedHistory && enrichedHistory.length > 0
        ? enrichedHistory[enrichedHistory.length - 1]
        : null;

    // Determine currently displayed item: check tracking list first, then temporary state
    const currentItem = items?.find(i => i.id === selectedItemId) || (selectedItemId === temporaryItem?.id ? temporaryItem : null);

    // Auto-select first item if none selected and we have items
    // ONLY on desktop. On mobile, we want to start with the list.
    // We can't easily detect "mobile" in initial state without window listener, 
    // but we can rely on CSS to hide the chart if we select it. 
    // However, if we auto-select on mobile, it will show the chart immediately which might be annoying.
    // Let's keep the auto-select but rely on the fact that if selectedItemId is set, 
    // the list is hidden on mobile.
    // Actually, for better UX on mobile, we might NOT want to auto-select.
    // But changing that logic might affect desktop. 
    // Let's stick to the conditional CSS approach first.
    if (items && items.length > 0 && !selectedItemId && !temporaryItem) {
        // Checking window.innerWidth in render is bad, but for effect initialization it is okay.
        // But here we are in render body.
        // Let's just default to selecting the first item.
        // Users can hit back if they are on mobile.
        setSelectedItemId(items[0].id);
    }

    const handleTemporarySelect = (item: Item) => {
        setTemporaryItem(item);
        setSelectedItemId(item.id);
    };

    const handleBack = () => {
        setSelectedItemId(null);
        setTemporaryItem(null);
    };

    const isItemSelected = !!selectedItemId;

    return (
        <div className="flex h-screen overflow-hidden bg-black flex-col md:flex-row">
            {/* Sidebar List */}
            {/* On mobile: Hide if item is selected. On desktop: Always show. */}
            <div className={`${isItemSelected ? 'hidden md:flex' : 'flex'} w-full md:w-80 border-r border-zinc-800 flex-col bg-zinc-950`}>
                <div className="p-4 border-b border-zinc-800">
                    <h2 className="text-xl font-bold text-white mb-2">Market Overview</h2>
                    <AutocompleteInput onSelect={handleTemporarySelect} />
                    <p className="text-xs text-gray-500 mt-2">Search to view temporarily</p>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {isLoading && <p className="p-4 text-gray-500">Loading items...</p>}
                    {items?.length === 0 && (
                        <div className="p-4 text-center text-gray-500">
                            <p>No items tracked.</p>
                            <p className="text-sm mt-2">Go to "Manage Items" to add some.</p>
                        </div>
                    )}
                    {items?.map(item => (
                        <div
                            key={item.id}
                            className={`p-3 rounded-lg cursor-pointer transition-all ${selectedItemId === item.id
                                ? 'bg-zinc-800 border-l-4 border-green-500 shadow-lg'
                                : 'hover:bg-zinc-900 border-l-4 border-transparent text-gray-400 hover:text-white'
                                }`}
                            onClick={() => {
                                setSelectedItemId(item.id);
                                setTemporaryItem(null); // Clear temp if switching to tracked
                            }}
                        >
                            <div className="flex justify-between items-center mb-1">
                                <span className="font-semibold truncate">{item.name}</span>
                                <span className="text-xs opacity-50">#{item.torn_id}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-green-500/80">${item.last_market_price?.toLocaleString() ?? '-'}</span>
                                <span className="text-blue-500/80">${item.last_bazaar_price?.toLocaleString() ?? '-'}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Chart Area */}
            {/* On mobile: Hide if NO item is selected. On desktop: Always show (or show empty state). */}
            <div className={`${!isItemSelected ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-w-0 bg-black p-4`}>
                {selectedItemId && currentItem ? (
                    <div className="flex-1 flex flex-col bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
                        <div className="p-4 md:p-6 border-b border-zinc-800 flex flex-col md:flex-row justify-between items-start md:items-center bg-zinc-900 gap-4">
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <button
                                    onClick={handleBack}
                                    className="md:hidden p-2 -ml-2 text-gray-400 hover:text-white"
                                >
                                    <ArrowLeft className="w-6 h-6" />
                                </button>
                                <div>
                                    <h1 className="text-lg md:text-2xl font-bold text-white mb-1 flex items-center gap-2">
                                        {currentItem.name}
                                        {!items?.find(i => i.id === currentItem.id) && <span className="text-[10px] md:text-xs bg-yellow-900 text-yellow-200 px-2 py-0.5 rounded">Temp</span>}
                                    </h1>
                                    <div className="flex items-center gap-3">
                                        <p className="text-xs md:text-sm text-gray-400">
                                            ID: {currentItem.torn_id}
                                        </p>
                                        <OrderBookButton itemId={currentItem.torn_id} itemName={currentItem.name} />
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-4 md:gap-6 w-full md:w-auto justify-between md:justify-end">
                                <div className="text-right">
                                    <p className="text-[10px] md:text-xs text-green-500 uppercase tracking-wider mb-1">Item Market</p>
                                    <div className="flex items-baseline justify-end gap-2">
                                        <span className="hidden md:inline text-xs text-zinc-500">Low</span>
                                        <span className="text-lg md:text-xl font-mono text-green-400 font-bold">
                                            ${currentItem.last_market_price?.toLocaleString() ?? '-'}
                                        </span>
                                    </div>
                                    <div className="flex items-baseline justify-end gap-2">
                                        <span className="hidden md:inline text-xs text-zinc-500">Avg</span>
                                        <span className="text-xs md:text-sm font-mono text-green-600/80">
                                            ${currentItem.last_market_price_avg?.toLocaleString() ?? '-'}
                                        </span>
                                    </div>
                                    <div className="flex items-baseline justify-end gap-2 mt-1">
                                        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Trend</span>
                                        <span className="text-xs md:text-sm font-mono text-fuchsia-400">
                                            ${latestPoint?.market_price_ma?.toLocaleString() ?? '-'}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-right border-l border-zinc-800 pl-4 md:pl-6">
                                    <p className="text-[10px] md:text-xs text-blue-500 uppercase tracking-wider mb-1">Bazaar</p>
                                    <div className="flex items-baseline justify-end gap-2">
                                        <span className="hidden md:inline text-xs text-zinc-500">Low</span>
                                        <span className="text-lg md:text-xl font-mono text-blue-400 font-bold">
                                            ${currentItem.last_bazaar_price?.toLocaleString() ?? '-'}
                                        </span>
                                    </div>
                                    <div className="flex items-baseline justify-end gap-2">
                                        <span className="hidden md:inline text-xs text-zinc-500">Avg</span>
                                        <span className="text-xs md:text-sm font-mono text-blue-600/80">
                                            ${currentItem.last_bazaar_price_avg?.toLocaleString() ?? '-'}
                                        </span>
                                    </div>
                                    <div className="flex items-baseline justify-end gap-2 mt-1">
                                        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Trend</span>
                                        <span className="text-xs md:text-sm font-mono text-orange-400">
                                            ${latestPoint?.bazaar_price_ma?.toLocaleString() ?? '-'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 p-2 md:p-4 min-h-0 relative">
                            {history && history.length > 0 ? (
                                <PriceChart
                                    data={history}
                                />
                            ) : (
                                <div className="absolute inset-0 flex flex-col gap-2 items-center justify-center text-gray-500">
                                    {history ? (
                                        <p>No history data available yet.</p>
                                    ) : (
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-600">
                        <p className="text-xl">Select an item to view chart</p>
                    </div>
                )}
            </div>
        </div>
    );
}
