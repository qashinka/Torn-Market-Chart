'use client';

import { ThemeProvider } from 'next-themes';

import { AuthProvider } from '@/contexts/auth-context';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem themes={['light', 'dark', 'black']}>
            <AuthProvider>
                {children}
            </AuthProvider>
        </ThemeProvider>
    );
}
