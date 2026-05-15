import { NavLink } from 'react-router-dom'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWsStore } from '@/lib/ws'

interface ShellProps {
  children: React.ReactNode
}

export default function Shell({ children }: ShellProps) {
  const agentsOnline = useWsStore(s => s.agentsOnline)
  const agentCount   = agentsOnline.size
  const hostnames    = [...agentsOnline.values()]

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-3">
        <div className="flex items-center gap-6">
          <span style={{ fontSize: 16, fontWeight: 500 }}>SyncTool</span>
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
              to="/download"
              className={({ isActive }) =>
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }
            >
              Download
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
