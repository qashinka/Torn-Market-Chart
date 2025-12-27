import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAlerts, createAlert, deleteAlert } from '@/lib/api';
import { Bell, Trash2, Plus, BellOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface AlertManagerProps {
    itemId: number;
    itemName: string;
}

export function AlertManager({ itemId, itemName }: AlertManagerProps) {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);

    // New alert state
    const [targetPrice, setTargetPrice] = useState('');
    const [condition, setCondition] = useState<'below' | 'above'>('below');
    const [isPersistent, setIsPersistent] = useState(false);

    const { data: alerts, isLoading } = useQuery({
        queryKey: ['alerts', itemId],
        queryFn: () => getAlerts(itemId),
        enabled: open // Only fetch when dialog is open
    });

    const createMutation = useMutation({
        mutationFn: async () => {
            if (!targetPrice) return;
            const price = parseInt(targetPrice.replace(/,/g, ''));
            if (isNaN(price)) return;
            await createAlert(itemId, price, condition, isPersistent);
            setTargetPrice('');
            setIsPersistent(false);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['alerts', itemId] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: deleteAlert,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['alerts', itemId] });
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        createMutation.mutate();
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <button
                    className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
                    title="Price Alerts"
                >
                    <Bell className="w-5 h-5" />
                </button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-800 text-white sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Bell className="w-5 h-5 text-yellow-500" />
                        Alerts for {itemName}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* List existing alerts */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-400">Active Alerts</h3>
                        {isLoading ? (
                            <div className="text-sm text-gray-500">Loading...</div>
                        ) : alerts?.length === 0 ? (
                            <div className="text-sm text-gray-500 flex items-center gap-2">
                                <BellOff className="w-4 h-4" />
                                No active alerts
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {alerts?.map(alert => (
                                    <div key={alert.id} className={`flex justify-between items-center bg-zinc-800 p-3 rounded border ${alert.is_active ? 'border-zinc-700' : 'border-zinc-700 opacity-50'}`}>
                                        <div className="flex items-center gap-3">
                                            <span className={`text-sm font-mono ${alert.condition === 'below' ? 'text-green-400' : 'text-red-400'}`}>
                                                {alert.condition === 'below' ? '<' : '>'} ${alert.target_price.toLocaleString()}
                                            </span>
                                            {!alert.is_active && <span className="text-xs bg-zinc-700 px-2 rounded">Triggered</span>}
                                            {alert.is_persistent && <span className="text-xs bg-blue-700 px-2 rounded">Recurring</span>}
                                        </div>
                                        <button
                                            onClick={() => deleteMutation.mutate(alert.id)}
                                            className="text-red-400 hover:text-red-300 p-1"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Create new alert */}
                    <div className="space-y-3 border-t border-zinc-800 pt-4">
                        <h3 className="text-sm font-semibold text-gray-400">Add New Alert</h3>
                        <form onSubmit={handleSubmit} className="space-y-3">
                            <div className="flex gap-3">
                                <select
                                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-sm"
                                    value={condition}
                                    onChange={(e) => setCondition(e.target.value as 'below' | 'above')}
                                >
                                    <option value="below">Price Below</option>
                                    <option value="above">Price Above</option>
                                </select>
                                <input
                                    type="number"
                                    placeholder="Target Price"
                                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 flex-grow text-white"
                                    value={targetPrice}
                                    onChange={(e) => setTargetPrice(e.target.value)}
                                    min="1"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="persistent"
                                    checked={isPersistent}
                                    onChange={(e) => setIsPersistent(e.target.checked)}
                                    className="w-4 h-4 accent-blue-500"
                                />
                                <label htmlFor="persistent" className="text-sm text-gray-300">Recurring (Keep active after trigger)</label>
                            </div>
                            <button
                                type="submit"
                                disabled={createMutation.isPending || !targetPrice}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium flex justify-center items-center gap-2 disabled:opacity-50"
                            >
                                <Plus className="w-4 h-4" />
                                Create Alert
                            </button>
                        </form>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
