import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { isLoggedIn } from '@/lib/auth'
import Dashboard from './routes/Dashboard'
import Jobs from './routes/Jobs'
import JobDetail from './routes/JobDetail'
import RunDetail from './routes/RunDetail'
import Devices from './routes/Devices'
import DeviceDetail from './routes/DeviceDetail'
import Login from './routes/Login'
import Download from './routes/Download'
import Audit from './routes/Audit'
import Endpoints from './routes/Endpoints'
import OrgSettings from './routes/OrgSettings'
import Analytics from './routes/Analytics'
import Templates from './routes/Templates'
import Collections from './routes/Collections'
import CollectionDetail from './routes/CollectionDetail'

const queryClient = new QueryClient()

function RequireAuth({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/download" element={<Download />} />
              <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
              <Route path="/jobs" element={<RequireAuth><Jobs /></RequireAuth>} />
              <Route path="/templates"   element={<RequireAuth><Templates /></RequireAuth>} />
              <Route path="/collections"     element={<RequireAuth><Collections /></RequireAuth>} />
              <Route path="/collections/:id" element={<RequireAuth><CollectionDetail /></RequireAuth>} />
              <Route path="/jobs/:id" element={<RequireAuth><JobDetail /></RequireAuth>} />
              <Route path="/jobs/:jobId/runs/:runId" element={<RequireAuth><RunDetail /></RequireAuth>} />
              <Route path="/devices" element={<RequireAuth><Devices /></RequireAuth>} />
              <Route path="/devices/:id" element={<RequireAuth><DeviceDetail /></RequireAuth>} />
              <Route path="/endpoints" element={<RequireAuth><Endpoints /></RequireAuth>} />
              <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
              <Route path="/org-settings" element={<RequireAuth><OrgSettings /></RequireAuth>} />
              <Route path="/analytics" element={<RequireAuth><Analytics /></RequireAuth>} />
            </Routes>
          </BrowserRouter>
          <Toaster richColors closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
