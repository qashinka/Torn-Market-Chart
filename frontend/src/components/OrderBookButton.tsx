import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getOrderBook, Listing } from '@/lib/api';

interface OrderBookButtonProps {
    itemId: number;
    itemName: string;
}

export function OrderBookButton({ itemId, itemName }: OrderBookButtonProps) {
    const [isOpen, setIsOpen] = useState(false);

    const { data: orderBook, isLoading } = useQuery({
        queryKey: ['orderbook', itemId],
        queryFn: () => getOrderBook(itemId),
        enabled: isOpen,
        refetchOnWindowFocus: false,
    });

    const marketListings = orderBook?.listings?.market?.slice(0, 5) || [];
    const bazaarListings = orderBook?.listings?.bazaar?.slice(0, 5) || [];

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="text-xs flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
            >
                <span>View Listings</span>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {isOpen && (
                <>
                    {/* Mobile Modal Backdrop / Desktop Invisible Wrapper (handled by inner absolute) */}
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm md:absolute md:inset-auto md:bg-transparent md:backdrop-blur-none md:p-0 md:block md:w-[600px] md:top-full md:left-0 md:mt-1">

                        {/* Content Container */}
                        <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-full max-w-sm md:max-w-none md:w-full overflow-hidden flex flex-col max-h-[80vh] md:max-h-none">
                            {isLoading ? (
                                <div className="p-4 text-center text-zinc-500">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mx-auto"></div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-700 overflow-y-auto md:overflow-visible">
                                    {/* Market Column */}
                                    <div className="p-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <h3 className="text-xs font-bold text-green-500 uppercase tracking-wide">Item Market</h3>
                                            <a
                                                href={`https://www.torn.com/imarket.php#/p=shop&step=shop&type=&searchname=${encodeURIComponent(itemName)}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-[10px] text-zinc-400 hover:text-white transition-colors"
                                            >
                                                Open Market →
                                            </a>
                                        </div>
                                        <div className="space-y-1">
                                            {marketListings.length > 0 ? (
                                                marketListings.map((listing, idx) => (
                                                    <ListingRow key={idx} listing={listing} rank={idx + 1} itemName={itemName} />
                                                ))
                                            ) : (
                                                <div className="text-xs text-zinc-500 py-2">No listings available</div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Bazaar Column */}
                                    <div className="p-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <h3 className="text-xs font-bold text-blue-500 uppercase tracking-wide">Bazaar</h3>
                                            <a
                                                href={`https://www.torn.com/bazaar.php`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-[10px] text-zinc-400 hover:text-white transition-colors"
                                            >
                                                Open Bazaar →
                                            </a>
                                        </div>
                                        <div className="space-y-1">
                                            {bazaarListings.length > 0 ? (
                                                bazaarListings.map((listing, idx) => (
                                                    <ListingRow key={idx} listing={listing} rank={idx + 1} itemName={itemName} />
                                                ))
                                            ) : (
                                                <div className="text-xs text-zinc-500 py-2">No listings available</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Close button for mobile only */}
                            <div className="p-3 border-t border-zinc-800 md:hidden">
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="w-full py-2 bg-zinc-800 rounded text-sm font-medium hover:bg-zinc-700 transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Backdrop to close on outside click */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsOpen(false)}
                />
            )}
        </div>
    );
}

interface ListingRowProps {
    listing: Listing;
    rank: number;
    itemName: string;
}

function ListingRow({ listing, rank, itemName }: ListingRowProps) {
    const getLink = () => {
        if (listing.type === 'market') {
            return `https://www.torn.com/imarket.php#/p=shop&step=shop&type=&searchname=${encodeURIComponent(itemName)}`;
        } else {
            // Bazaar link with userId if available
            return listing.id
                ? `https://www.torn.com/bazaar.php?userId=${listing.id}`
                : `https://www.torn.com/bazaar.php`;
        }
    };

    return (
        <a
            href={getLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-1.5 rounded hover:bg-zinc-800 transition-colors group"
        >
            <div className="flex items-center gap-2 flex-1">
                <span className="text-[10px] text-zinc-600 font-mono w-3">#{rank}</span>
                <span className="text-xs font-mono text-white font-semibold">
                    ${listing.price?.toLocaleString() ?? '-'}
                </span>
                <span className="text-[10px] text-zinc-500">
                    ×{listing.quantity?.toLocaleString() ?? '-'}
                </span>
            </div>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="8"
                height="8"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400"
            >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
        </a>
    );
}
