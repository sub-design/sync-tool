import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, HardDrive, Link2, BarChart3,
  FileText, Users, Settings, LogOut, Monitor, Sun, Moon, User,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useQuery } from '@tanstack/react-query'
import { useWsStore } from '@/lib/ws'
import { orgsApi } from '@/lib/orgs'
import { clearToken, clearOrgId } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ShellProps {
  children: React.ReactNode
}

type NavItem = { to: string; label: string; icon: React.ElementType; end?: boolean }

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Main',
    items: [
      { to: '/',          label: 'Jobs',      icon: LayoutDashboard, end: true },
      { to: '/devices',   label: 'Devices',   icon: HardDrive },
      { to: '/endpoints', label: 'Endpoints', icon: Link2 },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/audit',     label: 'Audit log', icon: FileText },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/org-settings', label: 'Team',     icon: Users },
      { to: '/download',     label: 'Get agent', icon: Settings },
    ],
  },
]

export default function Shell({ children }: ShellProps) {
  const navigate    = useNavigate()
  const { theme = 'system', setTheme } = useTheme()
  const agentsOnline = useWsStore(s => s.agentsOnline)
  const agentCount   = agentsOnline.size
  const hostnames    = [...agentsOnline.values()]

  const { data: org } = useQuery({
    queryKey: ['org-current'],
    queryFn:  orgsApi.getCurrent,
    staleTime: 60_000,
  })

  function handleSignOut() {
    clearToken()
    clearOrgId()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-background">
      {/* ── Sidebar ── */}
      <aside className="w-56 border-r border-border/60 bg-background flex-shrink-0 flex flex-col">
        {/* Wordmark */}
        <div className="h-14 px-4 border-b border-border/60 flex items-center">
          <NavLink to="/" className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">SyncTool</span>
            {org && (
              <span className="text-xs text-muted-foreground border rounded px-1.5 py-0.5 leading-none truncate max-w-[100px]">
                {org.name}
              </span>
            )}
          </NavLink>
        </div>

        {/* Nav */}
        <nav className="p-2 flex-1 flex flex-col justify-between overflow-y-auto">
          <div className="space-y-4">
            {NAV_GROUPS.map(group => (
              <div key={group.label}>
                <div className="px-2.5 pb-1.5 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {group.items.map(item => {
                    const Icon = item.icon
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.end}
                          className={({ isActive }) =>
                            `w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-sm font-medium transition-colors ${
                              isActive
                                ? 'bg-muted text-foreground'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`
                          }
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>

          {/* Agent status */}
          <div className="border-t border-border/60 pt-2 mt-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 px-2.5 h-8 text-xs text-muted-foreground cursor-default">
                  <span className={`inline-block size-2 rounded-full flex-shrink-0 ${agentCount > 0 ? 'bg-green-500' : 'bg-red-400'}`} />
                  <span className="truncate">
                    {agentCount > 0
                      ? `${agentCount} agent${agentCount > 1 ? 's' : ''} online`
                      : 'No agent connected'
                    }
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                {agentCount > 0 ? hostnames.join(', ') : 'Download the agent to get started'}
              </TooltipContent>
            </Tooltip>
          </div>
        </nav>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header */}
        <header className="h-14 border-b border-border/60 bg-background flex items-center gap-3 px-6 flex-shrink-0">
          <div className="flex-1" />

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open user menu">
                <User className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {org && (
                <>
                  <DropdownMenuLabel className="px-2 py-2">
                    <span className="block text-sm font-medium text-foreground">{org.name}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onSelect={() => navigate('/org-settings')}>
                <Users className="w-4 h-4" />
                Team settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Theme picker */}
              <div className="grid grid-cols-3 gap-1 px-1 py-1">
                <Button
                  variant={theme === 'system' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-full"
                  aria-label="System theme"
                  onClick={() => setTheme('system')}
                >
                  <Monitor className="w-4 h-4" />
                </Button>
                <Button
                  variant={theme === 'light' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-full"
                  aria-label="Light theme"
                  onClick={() => setTheme('light')}
                >
                  <Sun className="w-4 h-4" />
                </Button>
                <Button
                  variant={theme === 'dark' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-full"
                  aria-label="Dark theme"
                  onClick={() => setTheme('dark')}
                >
                  <Moon className="w-4 h-4" />
                </Button>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleSignOut}>
                <LogOut className="w-4 h-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
