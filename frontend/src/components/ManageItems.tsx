import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { getItems, createItem, deleteItem, Item } from '@/lib/api';
import { AutocompleteInput } from './AutocompleteInput';
import { Plus, Trash2 } from 'lucide-react';

export function ManageItems() {
    const queryClient = useQueryClient();
    const [newItemTornId, setNewItemTornId] = useState('');
    const [newItemName, setNewItemName] = useState('');

    const { data: items, isLoading } = useQuery<Item[]>({
        queryKey: ['items'],
        queryFn: getItems
    });

    const createItemMutation = useMutation({
        mutationFn: async () => {
            if (!newItemTornId || !newItemName) {
                console.error("Missing Torn ID or Name");
                return;
            }
            console.log("Creating item:", newItemTornId, newItemName);
            await createItem(parseInt(newItemTornId), newItemName);
            setNewItemTornId('');
            setNewItemName('');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['items'] });
            alert("Item added successfully!");
        },
        onError: (error) => {
            console.error("Failed to add item:", error);
            alert("Failed to add item. Check console for details.");
        }
    });

    const deleteItemMutation = useMutation({
        mutationFn: deleteItem,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['items'] });
        },
        onError: (error) => {
            console.error("Failed to remove item:", error);
            alert("Failed to remove item.");
        }
    });

    const handleCreateItem = (e: React.FormEvent) => {
        e.preventDefault();
        createItemMutation.mutate();
    }

    return (
        <div className="p-4 md:p-8 space-y-8 max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold mb-6">Manage Items</h2>

            {/* Item Creation Form */}
            <Card className="bg-zinc-900 border-zinc-800 p-6">
                <CardHeader>
                    <CardTitle className="text-white">Track New Item</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleCreateItem} className="flex flex-col gap-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="relative">
                                <label className="text-sm text-gray-400 block mb-2">Search Item Name</label>
                                <AutocompleteInput
                                    onSelect={(item) => {
                                        console.log("Selected:", item.torn_id, item.name);
                                        setNewItemTornId(item.torn_id.toString());
                                        setNewItemName(item.name);
                                    }}
                                />
                                <p className="text-xs text-gray-500 mt-1">Start typing to search Torn database</p>
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 block mb-2">Torn ID</label>
                                <input
                                    type="number"
                                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white w-full"
                                    value={newItemTornId}
                                    readOnly
                                    placeholder="ID will appear here"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={createItemMutation.isPending || !newItemTornId}
                                className={`px-6 py-2 rounded flex items-center gap-2 font-medium transition-colors ${!newItemTornId
                                    ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                                    }`}
                            >
                                {createItemMutation.isPending ? 'Adding...' : (
                                    <>
                                        <Plus className="w-4 h-4" />
                                        Add to Tracking
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <h3 className="text-xl font-bold text-white mt-12 mb-4">Currently Tracked Items ({items?.length || 0})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {isLoading && <p>Loading items...</p>}
                {items?.map(item => (
                    <Card key={item.id} className="bg-zinc-900 border-zinc-800 relative group">
                        <CardHeader className="pb-2">
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-white text-lg">{item.name}</CardTitle>
                                <div className="flex items-center gap-2">
                                    <span className="bg-zinc-800 text-xs px-2 py-1 rounded text-gray-400">ID: {item.torn_id}</span>
                                    <button
                                        onClick={() => {
                                            if (window.confirm(`Stop tracking ${item.name}?`)) {
                                                deleteItemMutation.mutate(item.id);
                                            }
                                        }}
                                        className="text-red-400 hover:text-red-300 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Stop Tracking"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex justify-between text-sm mt-2">
                                <div>
                                    <p className="text-gray-500 mb-1">Market Price</p>
                                    <p className="text-green-400 font-mono font-bold">{item.last_market_price ? `$${item.last_market_price.toLocaleString()}` : '-'}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-gray-500 mb-1">Bazaar Price</p>
                                    <p className="text-blue-400 font-mono font-bold">{item.last_bazaar_price ? `$${item.last_bazaar_price.toLocaleString()}` : '-'}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
