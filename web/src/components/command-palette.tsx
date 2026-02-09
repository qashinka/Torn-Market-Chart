"use client"

import * as React from "react"
import {
    Calendar,
    Mail,
    Smile,
    Settings,
    User,
    Rocket,
    FileText,
    LayoutDashboard,
    Search,
    LineChart,
    LogOut
} from "lucide-react"
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut
} from "@/components/ui/command"
import { useRouter } from "next/navigation"
import { api, Item } from "@/lib/api"
import { useAuth } from "@/contexts/auth-context"

export function CommandPalette() {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")
    const [items, setItems] = React.useState<Item[]>([])
    const router = useRouter()
    const { isAuthenticated, logout } = useAuth()

    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                setOpen((open) => !open)
            }
        }

        document.addEventListener("keydown", down)
        return () => document.removeEventListener("keydown", down)
    }, [])

    React.useEffect(() => {
        const search = async () => {
            if (!query) {
                // If query is empty, maybe show nothing or tracked items?
                // Let's show tracked items as default "recent" or "popular"
                try {
                    const data = await api.getTrackedItems()
                    setItems(data.slice(0, 10))
                } catch (e) { console.error(e) }
                return
            }

            try {
                const results = await api.searchItems(query)
                setItems(results)
            } catch (e) {
                console.error(e)
            }
        }

        const debounce = setTimeout(search, 300)
        return () => clearTimeout(debounce)
    }, [query, open])

    // Load initial items when opening
    React.useEffect(() => {
        if (open && !query) {
            api.getTrackedItems().then(data => setItems(data.slice(0, 10))).catch(console.error)
        }
    }, [open])

    const runCommand = React.useCallback((command: () => unknown) => {
        setOpen(false)
        command()
    }, [])

    return (
        <>
            <div className="fixed bottom-4 right-4 z-50 md:hidden">
                <button
                    onClick={() => setOpen(true)}
                    className="bg-primary text-primary-foreground rounded-full p-3 shadow-lg"
                >
                    <Search className="w-5 h-5" />
                </button>
            </div>

            <CommandDialog open={open} onOpenChange={setOpen}>
                <CommandInput
                    placeholder="Type a command or search items..."
                    value={query}
                    onValueChange={setQuery}
                />
                <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>
                    <CommandGroup heading="Suggestions">
                        <CommandItem onSelect={() => runCommand(() => router.push('/dashboard'))}>
                            <LayoutDashboard className="mr-2 h-4 w-4" />
                            <span>Dashboard</span>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => router.push('/watchlist'))}>
                            <LineChart className="mr-2 h-4 w-4" />
                            <span>Watchlist Matrix</span>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => router.push('/ranking'))}>
                            <Rocket className="mr-2 h-4 w-4" />
                            <span>Ranking</span>
                        </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                    <CommandGroup heading="Items">
                        {items.slice(0, 10).map((item) => (
                            <CommandItem
                                key={item.id}
                                onSelect={() => runCommand(() => router.push(`/items/${item.id}`))}
                            >
                                <Search className="mr-2 h-4 w-4" />
                                <span>{item.name}</span>
                                <span className="ml-auto text-xs text-muted-foreground">ID: {item.id}</span>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                    <CommandSeparator />
                    <CommandGroup heading="Settings">
                        <CommandItem onSelect={() => runCommand(() => router.push('/settings'))}>
                            <Settings className="mr-2 h-4 w-4" />
                            <span>Settings</span>
                            <CommandShortcut>⌘S</CommandShortcut>
                        </CommandItem>
                        {isAuthenticated && (
                            <CommandItem onSelect={() => runCommand(() => logout())}>
                                <LogOut className="mr-2 h-4 w-4" />
                                <span>Logout</span>
                            </CommandItem>
                        )}
                    </CommandGroup>
                </CommandList>
            </CommandDialog>
        </>
    )
}
