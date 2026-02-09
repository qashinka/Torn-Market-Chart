'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

export default function SettingsPage() {
    const { user, login, logout, isLoading, isAuthenticated } = useAuth();
    const [apiKey, setApiKey] = useState('');
    const [error, setError] = useState('');
    const [isLoginLoading, setIsLoginLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoginLoading(true);
        try {
            await login(apiKey);
            setApiKey('');
        } catch (err: any) {
            setError(err.message || 'Login failed');
        } finally {
            setIsLoginLoading(false);
        }
    };

    if (isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Loading settings...</div>;
    }

    return (
        <div className="bg-background text-foreground min-h-screen">
            <div className="container mx-auto p-4 md:p-8 space-y-8 max-w-4xl">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
                    <p className="text-muted-foreground">Manage your account and application preferences.</p>
                </div>

                <div className="grid gap-8">
                    {/* User Profile / Login Section */}
                    <section className="bg-card border rounded-xl p-6 shadow-sm">
                        <div className="mb-6">
                            <h2 className="text-xl font-semibold tracking-tight">User Profile</h2>
                            <p className="text-sm text-muted-foreground">Connect your Torn account to sync watchlists and alerts.</p>
                        </div>

                        {isAuthenticated && user ? (
                            <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 bg-muted/50 rounded-lg">
                                <div className="flex items-center gap-4">
                                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl">
                                        {user.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="font-medium text-lg">{user.name}</div>
                                        <div className="text-sm text-muted-foreground">ID: {user.id}</div>
                                    </div>
                                </div>
                                <button
                                    onClick={logout}
                                    className="px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                                >
                                    Sign Out
                                </button>
                            </div>
                        ) : (
                            <form onSubmit={handleLogin} className="space-y-4 max-w-md">
                                <div className="space-y-2">
                                    <label htmlFor="apiKey" className="text-sm font-medium">
                                        Torn API Key
                                    </label>
                                    <input
                                        id="apiKey"
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="Enter your Torn API Key"
                                        className="w-full px-3 py-2 bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        required
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Your key is used to verify your identity and is stored securely.
                                    </p>
                                </div>
                                {error && <div className="text-sm text-destructive">{error}</div>}
                                <button
                                    type="submit"
                                    disabled={isLoginLoading}
                                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                >
                                    {isLoginLoading ? 'Verifying...' : 'Connect User'}
                                </button>
                            </form>
                        )}
                    </section>

                    {/* Notification Settings */}
                    {isAuthenticated && <NotificationSettings />}

                    {/* Appearance Settings */}
                    <section className="bg-card border rounded-xl p-6 shadow-sm">
                        <AppearanceSettings />
                    </section>
                </div>
            </div>
        </div>
    );
}

function NotificationSettings() {
    const [webhookUrl, setWebhookUrl] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const settings = await api.getUserSettings();
            setWebhookUrl(settings.discord_webhook_url || '');
        } catch (error) {
            console.error('Failed to load user settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage('');
        try {
            await api.updateUserSetting('discord_webhook_url', webhookUrl);
            setMessage('Settings saved successfully!');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error('Failed to save settings:', error);
            setMessage('Failed to save settings.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return null;

    return (
        <section className="bg-card border rounded-xl p-6 shadow-sm">
            <div className="mb-6">
                <h2 className="text-xl font-semibold tracking-tight">Notifications</h2>
                <p className="text-sm text-muted-foreground">Configure how you want to receive alerts.</p>
            </div>

            <div className="space-y-4 max-w-md">
                <div className="space-y-2">
                    <label className="text-sm font-medium">Discord Webhook URL</label>
                    <input
                        type="url"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        placeholder="https://discord.com/api/webhooks/..."
                        className="w-full px-3 py-2 bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <p className="text-xs text-muted-foreground">
                        Create a webhook in your Discord server settings and paste the URL here to receive price alerts.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                        {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                    {message && (
                        <span className={`text-sm ${message.includes('Failed') ? 'text-destructive' : 'text-green-500'}`}>
                            {message}
                        </span>
                    )}
                </div>
            </div>
        </section>
    );
}

function AppearanceSettings() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // Prevent hydration mismatch
    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return null;
    }

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-xl font-semibold tracking-tight">Appearance</h2>
                <p className="text-sm text-muted-foreground">Customize the interface theme.</p>
            </div>
            <div className="flex flex-wrap gap-4">
                <button
                    onClick={() => setTheme('light')}
                    className={`px-4 py-2 rounded-lg border transition-all ${theme === 'light'
                        ? 'border-primary bg-secondary'
                        : 'border-border bg-card hover:bg-secondary/50'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-white border border-gray-200"></div>
                        <span>Light</span>
                    </div>
                </button>
                <button
                    onClick={() => setTheme('dark')}
                    className={`px-4 py-2 rounded-lg border transition-all ${theme === 'dark' || theme === 'system'
                        ? 'border-primary bg-secondary'
                        : 'border-border bg-card hover:bg-secondary/50'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-[#1a1a1a] border border-gray-600"></div>
                        <span>Midnight (Default)</span>
                    </div>
                </button>
                <button
                    onClick={() => setTheme('black')}
                    className={`px-4 py-2 rounded-lg border transition-all ${theme === 'black'
                        ? 'border-primary bg-secondary'
                        : 'border-border bg-black text-white hover:bg-gray-900'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-black border border-gray-800"></div>
                        <span>Pure Black</span>
                    </div>
                </button>
            </div>
        </div>
    );
}
