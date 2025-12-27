import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiKeys, createApiKey, deleteApiKey, getSystemConfig, updateSystemConfig } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, Key, Settings as SettingsIcon, Bell } from 'lucide-react';

export function Settings() {
    const queryClient = useQueryClient();
    const [newKey, setNewKey] = useState('');
    const [comment, setComment] = useState('');

    const { data: apiKeys, isLoading } = useQuery({
        queryKey: ['apiKeys'],
        queryFn: getApiKeys
    });

    const createMutation = useMutation({
        mutationFn: async () => {
            if (!newKey) return;
            await createApiKey(newKey, comment);
            setNewKey('');
            setComment('');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: deleteApiKey,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        createMutation.mutate();
    };

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Settings</h2>

            <Card className="bg-zinc-900 border-zinc-800 text-white">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Key className="w-5 h-5" />
                        API Keys
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <form onSubmit={handleSubmit} className="flex gap-2 items-center">
                        <input
                            type="text"
                            placeholder="Torn API Key"
                            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 flex-grow text-white"
                            value={newKey}
                            onChange={(e) => setNewKey(e.target.value)}
                        />
                        <input
                            type="text"
                            placeholder="Comment (optional)"
                            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 w-1/3 text-white"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                        />
                        <button
                            type="submit"
                            disabled={createMutation.isPending || !newKey}
                            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded flex items-center gap-2 disabled:opacity-50"
                        >
                            <Plus className="w-4 h-4" />
                            Add
                        </button>
                    </form>

                    <div className="space-y-2 mt-4">
                        {isLoading ? (
                            <p>Loading...</p>
                        ) : apiKeys?.length === 0 ? (
                            <p className="text-gray-400">No API keys configured.</p>
                        ) : (
                            apiKeys?.map((key) => (
                                <div key={key.id} className="flex justify-between items-center bg-zinc-800 p-3 rounded border border-zinc-700">
                                    <div className="overflow-hidden">
                                        <div className="font-mono text-sm break-all">{key.key.substr(0, 8)}...{key.key.substr(-4)}</div>
                                        {key.comment && <div className="text-xs text-gray-400">{key.comment}</div>}
                                    </div>
                                    <button
                                        onClick={() => deleteMutation.mutate(key.id)}
                                        className="text-red-400 hover:text-red-300 p-2"
                                        title="Delete Key"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>

            <ConfigSettings />
            <NotificationSettings />
        </div>
    );
}

function NotificationSettings() {
    const queryClient = useQueryClient();
    const [webhookUrl, setWebhookUrl] = useState('');

    const { data: config, isLoading } = useQuery({
        queryKey: ['systemConfig'],
        queryFn: getSystemConfig,
        staleTime: 0
    });

    React.useEffect(() => {
        if (config) {
            setWebhookUrl(config['discord_webhook_url'] || '');
        }
    }, [config]);

    const updateMutation = useMutation({
        mutationFn: async () => {
            await updateSystemConfig({
                'discord_webhook_url': webhookUrl
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['systemConfig'] });
            alert("Notification settings saved.");
        }
    });

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        updateMutation.mutate();
    };

    return (
        <Card className="bg-zinc-900 border-zinc-800 text-white">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Bell className="w-5 h-5" />
                    Notifications
                </CardTitle>
            </CardHeader>
            <CardContent>
                {isLoading ? <p>Loading...</p> : (
                    <form onSubmit={handleSave} className="space-y-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-2">
                                Discord Webhook URL
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="password"
                                    placeholder="https://discord.com/api/webhooks/..."
                                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 flex-grow text-white"
                                    value={webhookUrl}
                                    onChange={(e) => setWebhookUrl(e.target.value)}
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Alerts will be sent to this channel.
                            </p>
                        </div>
                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={updateMutation.isPending}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-medium"
                            >
                                {updateMutation.isPending ? 'Saving...' : 'Save Webhook'}
                            </button>
                        </div>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}

function ConfigSettings() {
    const queryClient = useQueryClient();
    const [rateLimit, setRateLimit] = useState('');
    const [interval, setInterval] = useState('');

    const { data: config, isLoading } = useQuery({
        queryKey: ['systemConfig'],
        queryFn: getSystemConfig,
        staleTime: 0
    });

    React.useEffect(() => {
        if (config) {
            setRateLimit(config['api_rate_limit'] || '50');
            setInterval(config['worker_interval_seconds'] || '60');
        }
    }, [config]);

    const updateMutation = useMutation({
        mutationFn: async () => {
            await updateSystemConfig({
                'api_rate_limit': rateLimit,
                'worker_interval_seconds': interval
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['systemConfig'] });
            alert("Settings updated. Effect depends on worker cycle.");
        }
    });

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        updateMutation.mutate();
    };

    return (
        <Card className="bg-zinc-900 border-zinc-800 text-white">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <SettingsIcon className="w-5 h-5" />
                    System Configuration
                </CardTitle>
            </CardHeader>
            <CardContent>
                {isLoading ? <p>Loading...</p> : (
                    <form onSubmit={handleSave} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm text-gray-400 mb-2">
                                    API Rate Limit (Req/Min/Key)
                                </label>
                                <input
                                    type="number"
                                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 w-full text-white"
                                    value={rateLimit}
                                    onChange={(e) => setRateLimit(e.target.value)}
                                    min="1"
                                    max="500"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    Requests per minute per key. Total limit scales with key count.
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-2">
                                    Worker Interval (Seconds)
                                </label>
                                <input
                                    type="number"
                                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 w-full text-white opacity-50 cursor-not-allowed"
                                    value={interval}
                                    onChange={(e) => setInterval(e.target.value)}
                                    disabled
                                    title="Currently fixed to 60s. Change in code if needed."
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    Execution frequency. Currently fixed to 60s (00s each minute).
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={updateMutation.isPending}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium"
                            >
                                {updateMutation.isPending ? 'Saving...' : 'Save Configuration'}
                            </button>
                        </div>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}
