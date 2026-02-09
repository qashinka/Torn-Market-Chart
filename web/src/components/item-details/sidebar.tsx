'use client';


import { Item } from '@/lib/api';
import { AnalysisPanel } from './analysis-panel';
import { WatchlistPanel } from './watchlist-panel';

interface SidebarProps {
    item: Item;
    priceType: 'market' | 'bazaar';
    isWatched: boolean;
}

export function ItemDetailsSidebar({ item, priceType, isWatched }: SidebarProps) {
    return (
        <div className="w-[320px] flex-none border-l border-[#2B2B43] bg-[#131722] flex flex-col overflow-hidden h-full">
            {/* Analysis Section (Takes remaining space) */}
            <div className="flex-1 overflow-hidden min-h-0 border-b border-[#2B2B43]">
                <AnalysisPanel item={item} priceType={priceType} isWatched={isWatched} />
            </div>

            {/* Watchlist Section (Fixed height) */}
            <div className="h-1/3 flex-none flex flex-col overflow-hidden bg-[#131722]">
                <div className="px-4 py-2 bg-[#1e222d] border-b border-[#2B2B43] flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                        Watchlist
                    </span>
                    <span className="text-[10px] text-gray-500 bg-[#2a2e39] px-1.5 py-0.5 rounded">
                        Quick Access
                    </span>
                </div>
                <div className="flex-1 overflow-hidden relative">
                    <WatchlistPanel currentItemId={item.id} />
                </div>
            </div>
        </div>
    );
}
