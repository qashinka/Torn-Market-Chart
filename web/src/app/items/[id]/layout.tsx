'use client';

import { ThemeProvider } from 'next-themes';

export default function ItemDetailLayout({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider forcedTheme="dark" attribute="class">
            {children}
        </ThemeProvider>
    );
}
