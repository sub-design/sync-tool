import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { isLoggedIn } from '@/lib/auth'
import Dashboard from './routes/Dashboard'
import JobDetail from './routes/JobDetail'
import Devices from './routes/Devices'
import Login from './routes/Login'
import Download from './routes/Download'
import Audit from './routes/Audit'
import Endpoints from './routes/Endpoints'
import OrgSettings from './routes/OrgSettings'

const queryClient = new QueryClient()

function RequireAuth({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/download" element={<Download />} />
            <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/jobs/:id" element={<RequireAuth><JobDetail /></RequireAuth>} />
            <Route path="/devices" element={<RequireAuth><Devices /></RequireAuth>} />
            <Route path="/endpoints" element={<RequireAuth><Endpoints /></RequireAuth>} />
            <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
            <Route path="/org-settings" element={<RequireAuth><OrgSettings /></RequireAuth>} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
