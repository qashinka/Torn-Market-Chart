'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

export default function SettingsPage() {
    const { user, token, login, logout, isLoading, isAuthenticated } = useAuth();
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
                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 p-4 bg-muted/50 rounded-lg">
                                <div className="flex flex-col gap-6 w-full">
                                    {/* Torn Account Info */}
                                    <div>
                                        <div className="text-sm font-medium mb-3 text-muted-foreground flex items-center gap-2">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                            Torn Account
                                        </div>
                                        {user.id > 0 ? (
                                            <div className="flex items-center gap-4 bg-background/50 p-3 rounded-md border">
                                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                                                    {user.name?.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-foreground">{user.name}</div>
                                                    <div className="text-xs text-muted-foreground">ID: {user.id}</div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-4">
                                                <div className="flex items-center gap-4 bg-destructive/10 p-3 rounded-md border border-destructive/20">
                                                    <div className="h-10 w-10 rounded-full bg-destructive/20 flex items-center justify-center text-destructive font-bold text-lg">
                                                        !
                                                    </div>
                                                    <div>
                                                        <div className="font-medium text-destructive">Not Linked to Torn</div>
                                                        <div className="text-xs text-muted-foreground">Enter your API key below to link.</div>
                                                    </div>
                                                </div>
                                                <form onSubmit={handleLogin} className="space-y-4 max-w-md">
                                                    <div className="space-y-2">
                                                        <input
                                                            id="apiKey"
                                                            type="password"
                                                            value={apiKey}
                                                            onChange={(e) => setApiKey(e.target.value)}
                                                            placeholder="Enter your Torn API Key"
                                                            className="w-full px-3 py-2 bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                                                            required
                                                        />
                                                    </div>
                                                    {error && <div className="text-sm text-destructive">{error}</div>}
                                                    <button
                                                        type="submit"
                                                        disabled={isLoginLoading}
                                                        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                                    >
                                                        {isLoginLoading ? 'Verifying...' : 'Link Torn Account'}
                                                    </button>
                                                </form>
                                            </div>
                                        )}
                                    </div>

                                    {/* Discord Account Info */}
                                    <div className="border-t pt-4">
                                        <div className="text-sm font-medium mb-3 text-muted-foreground flex items-center gap-2">
                                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
                                            </svg>
                                            Discord Account
                                            {user.discord_id && <span className="ml-auto text-xs px-2 py-0.5 bg-green-500/10 text-green-500 rounded-full">Connected</span>}
                                        </div>

                                        {user.discord_id ? (
                                            <div className="flex items-center gap-4 bg-background/50 p-3 rounded-md border border-[#5865F2]/20">
                                                {user.discord_avatar ? (
                                                    <img src={`https://cdn.discordapp.com/avatars/${user.discord_id}/${user.discord_avatar}.png`} alt="Discord Avatar" className="w-10 h-10 rounded-full ring-2 ring-[#5865F2]" />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-full bg-[#5865F2]/20 flex items-center justify-center text-[#5865F2] font-bold ring-2 ring-[#5865F2]">
                                                        {user.discord_username?.charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="font-medium text-foreground">{user.discord_username}</div>
                                                    <div className="text-xs text-muted-foreground">ID: {user.discord_id}</div>
                                                </div>
                                            </div>
                                        ) : (
                                            <a
                                                href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/v1/auth/discord/login?token=${token || ''}`}
                                                className="inline-flex items-center gap-2 px-4 py-2 bg-[#5865F2] text-white rounded-md hover:bg-[#4752C4] transition-colors text-sm font-medium"
                                            >
                                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
                                                </svg>
                                                Link Discord Account
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {/* Right Side Actions */}
                                <div className="mt-4 md:mt-0 flex flex-col justify-end">
                                    <button
                                        onClick={logout}
                                        className="w-full md:w-auto px-4 py-2 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-md transition-colors"
                                    >
                                        Log Out
                                    </button>
                                </div>
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
    const [webhookEnabled, setWebhookEnabled] = useState(true);
    const [dmEnabled, setDmEnabled] = useState(true);
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
            setWebhookEnabled(settings.global_webhook_enabled !== 'false');
            setDmEnabled(settings.discord_dm_enabled !== 'false');
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
            await Promise.all([
                api.updateUserSetting('discord_webhook_url', webhookUrl),
                api.updateUserSetting('global_webhook_enabled', webhookEnabled ? 'true' : 'false'),
                api.updateUserSetting('discord_dm_enabled', dmEnabled ? 'true' : 'false'),
            ]);
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

                <div className="space-y-4 pt-4 border-t">
                    <label className="flex items-center justify-between cursor-pointer">
                        <div className="space-y-0.5 max-w-[80%]">
                            <span className="text-sm font-medium text-foreground">Enable Global Webhook Alerts</span>
                            <p className="text-xs text-muted-foreground">
                                Receive price alert notifications in the Discord channel configured above.
                            </p>
                        </div>
                        <div className="relative inline-block w-11 h-6 select-none">
                            <input
                                type="checkbox"
                                checked={webhookEnabled}
                                onChange={(e) => setWebhookEnabled(e.target.checked)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0"
                            />
                            <div className={`block h-6 w-11 rounded-full transition-colors duration-200 ease-in-out ${webhookEnabled ? 'bg-primary' : 'bg-muted'}`}></div>
                            <div
                                className={`absolute left-[2px] top-[2px] block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${webhookEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                            ></div>
                        </div>
                    </label>

                    <label className="flex items-center justify-between cursor-pointer">
                        <div className="space-y-0.5 max-w-[80%]">
                            <span className="text-sm font-medium text-foreground">Enable Personal Discord DMs</span>
                            <p className="text-xs text-muted-foreground">
                                Receive direct messages from the Torn Market Chart bot for your active alerts. Requires a linked Discord account.
                            </p>
                        </div>
                        <div className="relative inline-block w-11 h-6 select-none">
                            <input
                                type="checkbox"
                                checked={dmEnabled}
                                onChange={(e) => setDmEnabled(e.target.checked)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0"
                            />
                            <div className={`block h-6 w-11 rounded-full transition-colors duration-200 ease-in-out ${dmEnabled ? 'bg-primary' : 'bg-muted'}`}></div>
                            <div
                                className={`absolute left-[2px] top-[2px] block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${dmEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                            ></div>
                        </div>
                    </label>
                </div>

                <div className="flex items-center gap-4 pt-4">
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
