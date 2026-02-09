'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';


import { useAuth } from '@/contexts/auth-context';

export function Header({ children }: { children?: React.ReactNode }) {
    const pathname = usePathname();
    const { user, isAuthenticated } = useAuth();

    // Hide header on item detail pages
    if (pathname && pathname.startsWith('/items/')) {
        return null;
    }

    return (
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <Link href="/" className="text-xl font-bold text-primary">
                        TMC
                    </Link>
                    <NavigationLinks />
                </div>
                <div className="flex items-center gap-4">
                    {isAuthenticated && user ? (
                        <Link href="/settings" className="text-sm font-medium hover:text-primary transition-colors">
                            {user.name}
                        </Link>
                    ) : (
                        <Link href="/settings" className="text-sm font-medium hover:text-primary transition-colors">
                            Log In
                        </Link>
                    )}
                    {children}
                </div>
            </div>
        </header>
    );
}

function NavigationLinks() {
    const links = [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/watchlist', label: 'Matrix' },
        { href: '/ranking', label: 'Ranking' },
        { href: '/settings', label: 'Settings' },
    ];

    return (
        <nav className="hidden md:flex gap-4">
            {links.map(link => (
                <Link
                    key={link.href}
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground font-medium transition-colors"
                >
                    {link.label}
                </Link>
            ))}
        </nav>
    );
}
