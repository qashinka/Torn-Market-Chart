'use client';

import { useState, useEffect } from 'react';
import { api, Listing } from '@/lib/api';
import { ExternalLink } from 'lucide-react';

interface TopListingsProps {
    listings: Listing[];
    loading: boolean;
}

export function TopListings({ listings, loading }: TopListingsProps) {
    const formatPrice = (price: number) => {
        if (price >= 1_000_000_000) return `$${(price / 1_000_000_000).toFixed(2)}B`;
        if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(2)}M`;
        if (price >= 1_000) return `$${(price / 1_000).toFixed(1)}K`;
        return `$${price.toLocaleString()}`;
    };

    if (loading) {
        return (
            <div className="animate-pulse space-y-2">
                <div className="h-6 bg-[#2a2e39] rounded w-full" />
                <div className="h-6 bg-[#2a2e39] rounded w-full" />
                <div className="h-6 bg-[#2a2e39] rounded w-3/4" />
            </div>
        );
    }

    if (listings.length === 0) {
        return (
            <p className="text-gray-500 text-xs text-center py-2">
                No listings available
            </p>
        );
    }

    return (
        <div className="space-y-1">
            {listings.map((listing, index) => (
                <a
                    key={`${listing.player_id}-${index}`}
                    href={listing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-2 rounded bg-[#1e222d] hover:bg-[#2a2e39] transition-colors group"
                >
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-gray-500 w-4">
                            #{index + 1}
                        </span>
                        <div className="flex flex-col">
                            <span className="text-xs text-gray-300 group-hover:text-[#2962FF] transition-colors">
                                {listing.player_name || (listing.player_id > 0 ? `[${listing.player_id}]` : 'Market')}
                            </span>
                            {listing.quantity > 0 && (
                                <span className="text-[10px] text-gray-500">
                                    x{listing.quantity}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {listing.price > 0 && (
                            <span className="text-xs font-medium text-green-400">
                                {formatPrice(listing.price)}
                            </span>
                        )}
                        <ExternalLink className="w-3 h-3 text-gray-500 group-hover:text-[#2962FF] transition-colors" />
                    </div>
                </a>
            ))}
        </div>
    );
}
