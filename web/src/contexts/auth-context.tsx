'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface User {
    id: number;
    name: string;
    created_at: string;
    last_login_at: string;
    discord_id?: string;
    discord_username?: string;
    discord_avatar?: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (apiKey: string) => Promise<void>;
    loginWithToken: (token: string) => Promise<void>;
    logout: () => void;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    // Check for existing token on mount
    useEffect(() => {
        const storedToken = localStorage.getItem('auth_token');
        if (storedToken) {
            setToken(storedToken);
            fetchUser(storedToken);
        } else {
            setIsLoading(false);
        }
    }, []);

    // Sync token with API client
    useEffect(() => {
        api.setToken(token);
    }, [token]);

    const fetchUser = async (authToken: string) => {
        try {
            const userData = await api.getMe(authToken);
            setUser(userData);
        } catch (error) {
            console.error('Failed to fetch user:', error);
            logout(); // Invalid token
        } finally {
            setIsLoading(false);
        }
    };

    const login = async (apiKey: string) => {
        setIsLoading(true);
        try {
            const response = await api.login(apiKey);
            const { token, user } = response;

            localStorage.setItem('auth_token', token);
            setToken(token);
            setUser(user);
            router.refresh();
        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    };

    const loginWithToken = async (newToken: string) => {
        setIsLoading(true);
        try {
            const userData = await api.getMe(newToken);
            localStorage.setItem('auth_token', newToken);
            setToken(newToken);
            setUser(userData);
            router.refresh();
        } catch (error) {
            console.error('Login with token failed:', error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    };

    const logout = () => {
        localStorage.removeItem('auth_token');
        setToken(null);
        setUser(null);
        router.push('/settings'); // Redirect to login page (settings)
    };

    return (
        <AuthContext.Provider value={{
            user,
            token,
            isLoading,
            login,
            loginWithToken,
            logout,
            isAuthenticated: !!user
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
