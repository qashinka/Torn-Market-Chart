import { useState } from 'react';
import { Dashboard } from "@/components/Dashboard"
import { Settings } from "@/components/Settings"
import { ManageItems } from "@/components/ManageItems"
import { LayoutDashboard, Settings as SettingsIcon, Package } from 'lucide-react';

function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'items' | 'settings'>('dashboard');
  const [dashboardKey, setDashboardKey] = useState(0);

  const handleHomeClick = () => {
    setCurrentView('dashboard');
    if (currentView === 'dashboard') {
      // Force remount
      setDashboardKey(prev => prev + 1);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col md:flex-row">
      {/* Sidebar - Desktop Only */}
      <div className="hidden md:flex w-64 border-r border-zinc-800 p-4 space-y-4 flex-shrink-0 h-screen sticky top-0 flex-col z-50 bg-black">
        <button onClick={handleHomeClick} className="text-left px-4 mb-8 focus:outline-none hover:opacity-80 transition-opacity">
          <h1 className="text-xl font-bold text-green-500">Torn Market</h1>
        </button>

        <nav className="space-y-2 flex-1">
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
      <div className="flex-1 bg-black pb-20 md:pb-0 min-h-screen">
        {currentView === 'dashboard' ? <Dashboard key={dashboardKey} /> : currentView === 'items' ? <ManageItems /> : <div className="p-4 md:p-8"><Settings /></div>}
      </div>

      {/* Bottom Navigation - Mobile Only */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-800 flex justify-around p-2 z-50">
        <button
          onClick={() => setCurrentView('dashboard')}
          className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${currentView === 'dashboard' ? 'text-green-500' : 'text-gray-400'}`}
        >
          <LayoutDashboard className="w-6 h-6" />
          <span className="text-xs">Dashboard</span>
        </button>
        <button
          onClick={() => setCurrentView('items')}
          className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${currentView === 'items' ? 'text-green-500' : 'text-gray-400'}`}
        >
          <Package className="w-6 h-6" />
          <span className="text-xs">Items</span>
        </button>
        <button
          onClick={() => setCurrentView('settings')}
          className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${currentView === 'settings' ? 'text-green-500' : 'text-gray-400'}`}
        >
          <SettingsIcon className="w-6 h-6" />
          <span className="text-xs">Settings</span>
        </button>
      </div>
    </div>
  )
}

export default App
