import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, Search } from 'lucide-react';

import { PriceChart } from './PriceChart';
import { MarketOverview } from './MarketOverview';
import { AutocompleteInput } from './AutocompleteInput';
import { OrderBookButton } from './OrderBookButton';
import { AlertManager } from './AlertManager';
import { getItems, Item } from '@/lib/api';

export function Dashboard() {
    const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
    // Store temporarily selected item object for display if not in the tracked list
    const [temporaryItem, setTemporaryItem] = useState<Item | null>(null);

    const { data: items, isLoading } = useQuery<Item[]>({
        queryKey: ['items'],
        queryFn: () => getItems(true)
    });

    // History fetch removed to prevent double-loading. PriceChart handles its own data.
    // const { data: history } = useQuery(...) 

    // Trend calculation removed as it depended on heavy history fetch.

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




    const handleTemporarySelect = (item: Item) => {
        setTemporaryItem(item);
        setSelectedItemId(item.id);
    };

    const handleBack = () => {
        setSelectedItemId(null);
        setTemporaryItem(null);
    };
    // Mobile selection state
    const isItemSelected = !!selectedItemId;

    // Desktop sidebar collapse state
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Filter sidebar list (only tracked items)
    const sidebarItems = items?.filter(i => i.is_tracked) || [];

    return (
        <div className="flex h-full relative">
            {/* Desktop Collapsible Sidebar */}
            <div
                className={`
                    transition-all duration-300 ease-in-out border-r border-zinc-800 bg-zinc-950 flex flex-col
                    ${isSidebarOpen ? 'w-80 translate-x-0' : 'w-0 -translate-x-full border-r-0 overflow-hidden opacity-0'}
                    ${isItemSelected ? 'hidden md:flex' : 'flex'} 
                    md:relative absolute z-20 h-full
                `}
            >
                <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white whitespace-nowrap overflow-hidden">Overview</h2>
                    <button onClick={() => setIsSidebarOpen(false)} className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-4 py-2">
                    <AutocompleteInput onSelect={handleTemporarySelect} />
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {isLoading && <p className="p-4 text-gray-500">Loading items...</p>}
                    {sidebarItems.length === 0 && !isLoading && (
                        <div className="p-4 text-center text-gray-500">
                            <p>No items tracked.</p>
                            <p className="text-sm mt-2">Go to "Manage Items" to add some.</p>
                        </div>
                    )}
                    {sidebarItems.map(item => (
                        <div
                            key={item.id}
                            className={`p-3 rounded-lg cursor-pointer transition-all ${selectedItemId === item.id
                                ? 'bg-zinc-800 border-l-4 border-green-500 shadow-lg'
                                : 'hover:bg-zinc-900 border-l-4 border-transparent text-gray-400 hover:text-white'
                                } `}
                            onClick={() => {
                                setSelectedItemId(item.id);
                                setTemporaryItem(null); // Clear temp if switching to tracked
                                // On mobile, we might want to auto-close? No, CSS handles it.
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

            {/* Main Content Area */}
            {/* On mobile: Hide if NO item is selected. On desktop: Always show (or show empty state). */}
            <div className={`flex-1 flex flex-col min-w-0 bg-black p-4 relative transition-all duration-300 ${!isItemSelected ? 'hidden md:flex' : 'flex'}`}>

                {/* Expand sidebar button (Desktop only, when closed) */}
                {!isSidebarOpen && (
                    <button
                        onClick={() => setIsSidebarOpen(true)}
                        className="absolute top-4 left-4 z-30 p-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white shadow-xl hover:bg-zinc-800 transition-colors hidden md:flex items-center gap-2"
                    >
                        <Search className="w-4 h-4" />
                        <span className="text-sm font-medium">Find Item</span>
                    </button>
                )}
                {selectedItemId && currentItem ? (
                    <div className="flex-1 flex flex-col bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
                        <div className="p-4 md:p-6 border-b border-zinc-800 flex flex-col md:flex-row justify-between items-start md:items-center bg-zinc-900 gap-4">
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <button
                                    onClick={handleBack}
                                    type="button"
                                    className="md:hidden p-3 -ml-3 text-gray-400 hover:text-white relative z-10 hover:bg-zinc-800/50 rounded-full transition-colors"
                                    aria-label="Back to items"
                                >
                                    <ArrowLeft className="w-6 h-6 pointer-events-none" />
                                </button>
                                <div>
                                    <h1 className="text-lg md:text-2xl font-bold text-white mb-1 flex items-center gap-2">
                                        {currentItem.name}
                                        {!currentItem.is_tracked && <span className="text-[10px] md:text-xs bg-yellow-900 text-yellow-200 px-2 py-0.5 rounded">Temp</span>}
                                    </h1>
                                    <div className="flex items-center gap-3">
                                        <p className="text-xs md:text-sm text-gray-400">
                                            ID: {currentItem.torn_id}
                                        </p>
                                        <OrderBookButton itemId={currentItem.torn_id} itemName={currentItem.name} />
                                        <AlertManager itemId={currentItem.id} itemName={currentItem.name} />
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
                                        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Trend (24h)</span>
                                        <span className="text-xs md:text-sm font-mono text-fuchsia-400">
                                            ${currentItem.last_market_trend?.toLocaleString() ?? '-'}
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
                                        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Trend (24h)</span>
                                        <span className="text-xs md:text-sm font-mono text-orange-400">
                                            ${currentItem.last_bazaar_trend?.toLocaleString() ?? '-'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 p-2 md:p-4 min-h-0 relative">
                            {selectedItemId ? (
                                <PriceChart
                                    itemId={selectedItemId}
                                />
                            ) : (
                                <div className="absolute inset-0 flex flex-col gap-2 items-center justify-center text-gray-500">
                                    <p>No item selected.</p>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <MarketOverview
                        items={items || []}
                        onSelect={(item) => setSelectedItemId(item.id)}
                    />
                )}
            </div>
        </div>
    );
}
