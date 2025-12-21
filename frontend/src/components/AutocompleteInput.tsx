import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTornItems, Item } from '@/lib/api';

interface AutocompleteInputProps {
    onSelect: (item: Item) => void;
}

export function AutocompleteInput({ onSelect }: AutocompleteInputProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const { data: tornItems } = useQuery<Item[]>({
        queryKey: ['tornItems'],
        queryFn: getTornItems,
        staleTime: 1000 * 60 * 60 * 24 // Cache for 24h
    });

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [wrapperRef]);

    const filteredItems = tornItems
        ? tornItems
            .filter((item) => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .slice(0, 10) // Limit to 10 results
        : [];

    return (
        <div ref={wrapperRef} className="relative w-full">
            <input
                type="text"
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white w-full"
                placeholder="Type item name..."
                value={searchTerm}
                onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
            />

            {isOpen && searchTerm && filteredItems.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg max-h-60 overflow-y-auto">
                    {filteredItems.map((item) => (
                        <div
                            key={item.torn_id}
                            className="px-4 py-2 hover:bg-zinc-700 cursor-pointer text-white flex justify-between items-center"
                            onClick={() => {
                                onSelect(item);
                                setSearchTerm(item.name);
                                setIsOpen(false);
                            }}
                        >
                            <span>{item.name}</span>
                            <span className="text-xs text-gray-500">ID: {item.torn_id}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
