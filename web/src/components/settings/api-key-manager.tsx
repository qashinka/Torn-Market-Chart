'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2, Key, Activity, ShieldCheck, AlertCircle } from 'lucide-react';

interface ApiKey {
    id: string;
    label: string;
    is_active: boolean;
    created_at: string;
    last_used_at: string | null;
    usage_count: number;
    error_count: number;
}

export function ApiKeyManager() {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [newKey, setNewKey] = useState('');
    const [label, setLabel] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchKeys();
    }, []);

    const fetchKeys = async () => {
        try {
            const res = await fetch('http://localhost:8080/api/v1/settings/keys');
            if (res.ok) {
                const data = await res.json();
                setKeys(data || []);
            }
        } catch (e) {
            console.error('Failed to fetch keys', e);
        }
    };

    const handleAddKey = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!newKey || !label) return;

        setLoading(true);
        try {
            const res = await fetch('http://localhost:8080/api/v1/settings/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: newKey, label }),
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to add key');
            }

            setNewKey('');
            setLabel('');
            fetchKeys();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteKey = async (id: string) => {
        if (!confirm('Are you sure you want to delete this key?')) return;
        try {
            await fetch(`http://localhost:8080/api/v1/settings/keys/${id}`, {
                method: 'DELETE',
            });
            fetchKeys();
        } catch (e) {
            console.error('Failed to delete key', e);
        }
    };

    return (
        <Card className="w-full bg-[#131722] border-[#2B2B43] text-gray-300">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[#e1e1e1]">
                    <ShieldCheck className="w-5 h-5 text-[#4caf50]" />
                    API Key Management
                </CardTitle>
                <CardDescription className="text-gray-500">
                    Add your Torn API keys to access personal data (Inventory) and contribute to the community crawler.
                    <br />
                    <span className="text-[#f59e0b] text-xs">
                        Keys are encrypted (AES-256) and used to fetch market data efficiently.
                    </span>
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Add Key Form */}
                <form onSubmit={handleAddKey} className="flex flex-col gap-4 p-4 rounded-lg bg-[#1e222d] border border-[#2B2B43]">
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="text-xs text-gray-400 mb-1 block">Label (e.g. Main Account)</label>
                            <Input
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder="My Account"
                                className="bg-[#131722] border-[#2B2B43] text-gray-200"
                                required
                            />
                        </div>
                        <div className="flex-[2]">
                            <label className="text-xs text-gray-400 mb-1 block">API Key (Public Only Recommended)</label>
                            <Input
                                value={newKey}
                                onChange={(e) => setNewKey(e.target.value)}
                                placeholder="Enter your 16-character Torn API Key"
                                className="bg-[#131722] border-[#2B2B43] text-gray-200 font-mono"
                                type="password"
                                required
                            />
                        </div>
                        <div className="flex items-end">
                            <Button
                                type="submit"
                                disabled={loading}
                                className="bg-[#2962FF] hover:bg-[#1e4bd1] text-white"
                            >
                                {loading ? 'Adding...' : 'Add Key'}
                            </Button>
                        </div>
                    </div>
                    {error && (
                        <div className="flex items-center gap-2 text-[#f23645] text-sm">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}
                </form>

                {/* Key List */}
                <div className="space-y-2">
                    <h3 className="text-sm font-medium text-gray-400">Registered Keys</h3>
                    {keys.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No keys registered yet.</p>
                    ) : (
                        <div className="grid gap-2">
                            {keys.map((key) => (
                                <div key={key.id} className="flex justify-between items-center p-3 rounded bg-[#1e222d] border border-[#2B2B43]">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-2 rounded-full ${key.is_active ? 'bg-[#4caf50]/20 text-[#4caf50]' : 'bg-[#f23645]/20 text-[#f23645]'}`}>
                                            <Key className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <div className="font-medium text-[#e1e1e1]">{key.label}</div>
                                            <div className="text-xs text-gray-500 flex items-center gap-2">
                                                ID: {key.id.substring(0, 8)}...
                                                <span>•</span>
                                                Added: {new Date(key.created_at).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <div className="text-xs text-gray-400">Requests</div>
                                            <div className="flex items-center gap-1 text-sm font-mono text-[#d1d5db]">
                                                <Activity className="w-3 h-3 text-[#2962FF]" />
                                                {key.usage_count.toLocaleString()}
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <div className="text-xs text-gray-400">Status</div>
                                            <div className={`text-xs font-bold ${key.is_active ? 'text-[#4caf50]' : 'text-[#f23645]'}`}>
                                                {key.is_active ? 'ACTIVE' : 'INACTIVE'}
                                            </div>
                                        </div>

                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDeleteKey(key.id)}
                                            className="text-gray-500 hover:text-[#f23645] hover:bg-[#f23645]/10"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
