'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

function OAuthCallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { loginWithToken } = useAuth();
    const [status, setStatus] = useState('Processing authentication...');

    useEffect(() => {
        const token = searchParams.get('token');
        const error = searchParams.get('error');

        if (error) {
            setStatus(`Authentication failed: ${error}`);
            setTimeout(() => router.push('/settings'), 3000);
            return;
        }

        if (token) {
            setStatus('Logging in...');
            loginWithToken(token)
                .then(() => {
                    setStatus('Success! Redirecting...');
                    router.push('/settings');
                })
                .catch((err) => {
                    console.error('Failed to login with OAuth token:', err);
                    setStatus('Failed to verify token. Please try again.');
                    setTimeout(() => router.push('/settings'), 3000);
                });
        } else {
            setStatus('Invalid callback URL.');
            setTimeout(() => router.push('/settings'), 2000);
        }
    }, [searchParams, loginWithToken, router]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="bg-card border rounded-xl p-8 max-w-md w-full text-center shadow-lg">
                <div className="h-12 w-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
                <h1 className="text-xl font-semibold mb-2">Connecting to Discord</h1>
                <p className="text-muted-foreground">{status}</p>
            </div>
        </div>
    );
}

export default function OAuthCallbackPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="bg-card border rounded-xl p-8 max-w-md w-full text-center shadow-lg">
                    <div className="h-12 w-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
                    <h1 className="text-xl font-semibold mb-2">Loading</h1>
                </div>
            </div>
        }>
            <OAuthCallbackContent />
        </Suspense>
    );
}
