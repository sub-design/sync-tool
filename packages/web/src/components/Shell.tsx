import { NavLink } from 'react-router-dom'
import { Server, Settings2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWsStore } from '@/lib/ws'
import { orgsApi } from '@/lib/orgs'

interface ShellProps {
  children: React.ReactNode
}

export default function Shell({ children }: ShellProps) {
  const agentsOnline = useWsStore(s => s.agentsOnline)
  const agentCount   = agentsOnline.size
  const hostnames    = [...agentsOnline.values()]

  const { data: org } = useQuery({
    queryKey: ['org-current'],
    queryFn:  orgsApi.getCurrent,
    staleTime: 60_000,
  })

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-3">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 16, fontWeight: 500 }}>SyncTool</span>
            {org && (
              <span className="text-xs text-muted-foreground border rounded px-1.5 py-0.5 leading-none">
                {org.name}
              </span>
            )}
          </div>
          <nav className="flex gap-4 text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }
            >
              Jobs
            </NavLink>
            <NavLink
              to="/devices"
              className={({ isActive }) =>
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }
            >
              Devices
            </NavLink>
            <NavLink
              to="/endpoints"
              className={({ isActive }) =>
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }
            >
              <span className="flex items-center gap-1">
                <Server size={13} />
                Endpoints
              </span>
            </NavLink>
            <NavLink
              to="/audit"
              className={({ isActive }) =>
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }
            >
              Audit
            </NavLink>
            <NavLink
              to="/download"
              className={({ isActive }) =>
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }
            >
              Download
            </NavLink>
            <NavLink
              to="/org-settings"
              className={({ isActive }) =>
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }
            >
              <span className="flex items-center gap-1">
                <Settings2 size={13} />
                Team
              </span>
            </NavLink>
          </nav>
        </div>

        <Tooltip>
          <TooltipTrigger className="flex items-center gap-1.5 text-sm">
            <span
              className={`inline-block size-2 rounded-full ${agentCount > 0 ? 'bg-green-500' : 'bg-red-500'}`}
            />
            {agentCount > 0
              ? `${agentCount} agent${agentCount > 1 ? 's' : ''} online`
              : <><span>No agent connected</span><NavLink to="/download" className="ml-1.5 underline underline-offset-2 hover:text-foreground">Get the app ↗</NavLink></>
            }
          </TooltipTrigger>
          <TooltipContent>
            {agentCount > 0 ? hostnames.join(', ') : 'No agents connected'}
          </TooltipContent>
        </Tooltip>
      </header>

      <main className="mx-auto w-full max-w-[960px] px-6 py-6 space-y-6">
        {children}
      </main>
    </div>
  )
}
