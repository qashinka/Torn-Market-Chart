import { useState } from 'react';
import { Dashboard } from "@/components/Dashboard"
import { Settings } from "@/components/Settings"
import { ManageItems } from "@/components/ManageItems"
import { LayoutDashboard, Settings as SettingsIcon, Package } from 'lucide-react';

function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'items' | 'settings'>('dashboard');

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Sidebar */}
      <div className="w-64 border-r border-zinc-800 p-4 space-y-4 flex-shrink-0">
        <h1 className="text-xl font-bold px-4 mb-8 text-green-500">Torn Market</h1>

        <nav className="space-y-2">
          <button
            onClick={() => setCurrentView('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${currentView === 'dashboard' ? 'bg-zinc-800 text-white' : 'text-gray-400 hover:text-white hover:bg-zinc-900'}`}
          >
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </button>
          <button
            onClick={() => setCurrentView('items')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${currentView === 'items' ? 'bg-zinc-800 text-white' : 'text-gray-400 hover:text-white hover:bg-zinc-900'}`}
          >
            <Package className="w-5 h-5" />
            Manage Items
          </button>
          <button
            onClick={() => setCurrentView('settings')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${currentView === 'settings' ? 'bg-zinc-800 text-white' : 'text-gray-400 hover:text-white hover:bg-zinc-900'}`}
          >
            <SettingsIcon className="w-5 h-5" />
            Settings
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-black">
        {currentView === 'dashboard' ? <Dashboard /> : currentView === 'items' ? <ManageItems /> : <div className="p-8"><Settings /></div>}
      </div>
    </div>
  )
}

export default App
