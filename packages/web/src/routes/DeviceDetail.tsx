import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle, CheckCircle, Circle, Monitor, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import Shell from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { formatRelative, formatAbsolute } from '@/lib/format'
import * as api from '@/lib/api'
import { useWsStore, subscribe } from '@/lib/ws'

export default function DeviceDetail() {
  const { id } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<'overview' | 'jobs' | 'diagnostics' | 'logs'>('overview')
  const agentsOnline = useWsStore(s => s.agentsOnline)

  const { data: device, isLoading, isError } = useQuery({
    queryKey: ['device', id],
    queryFn: () => api.getDevice(id!),
    enabled: !!id,
    retry: false,
  })

  // Subscribe to WebSocket events for real-time device status updates
  useEffect(() => {
    const unsubOnline = subscribe('agent:online', (msg) => {
      if (msg.deviceId === id) {
        // Invalidate device query to refresh data
        // This will trigger a re-fetch of device data
      }
    })

    const unsubOffline = subscribe('agent:offline', (msg) => {
      if (msg.deviceId === id) {
        // Invalidate device query to refresh data
      }
    })

    return () => {
      unsubOnline()
      unsubOffline()
    }
  }, [id])

  // Determine online status from WebSocket store or device status
  const isOnline = agentsOnline.has(id!) || device?.status === 'online'

  const { data: jobs = [] } = useQuery({
    queryKey: ['device-jobs', id],
    queryFn: () => api.getDeviceJobs(id!),
    enabled: !!id,
  })

  const { data: syncHistory = [] } = useQuery({
    queryKey: ['device-sync-history', id],
    queryFn: () => api.getDeviceSyncHistory(id!, 50),
    enabled: !!id,
  })

  const { data: diagnostics } = useQuery({
    queryKey: ['device-diagnostics', id],
    queryFn: () => api.getDeviceDiagnostics(id!),
    enabled: !!id,
  })

  const testConnectionMutation = useMutation({
    mutationFn: () => api.testDeviceConnection(id!),
    onSuccess: (data) => {
      toast.success(data.message)
    },
    onError: () => {
      toast.error('Failed to test connection')
    },
  })

  const updateClientMutation = useMutation({
    mutationFn: () => api.updateDeviceClient(id!),
    onSuccess: (data) => {
      toast.success(data.message)
    },
    onError: () => {
      toast.error('Failed to update client')
    },
  })

  const restartAgentMutation = useMutation({
    mutationFn: () => api.restartDeviceAgent(id!),
    onSuccess: (data) => {
      toast.success(data.message)
    },
    onError: () => {
      toast.error('Failed to restart agent')
    },
  })

  if (isLoading) {
    return <Shell><p className="text-sm text-muted-foreground">Loading…</p></Shell>
  }

  if (isError || !device) {
    return (
      <Shell>
        <div className="space-y-3">
          <Link to="/devices" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Devices
          </Link>
          <p className="text-sm">Device not found.</p>
        </div>
      </Shell>
    )
  }

  const lastSeenRelative = device.lastSeen ? formatRelative(device.lastSeen) : 'Never'

  return (
    <Shell>
      <div className="space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/devices">Devices</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{device.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/30">
              <Monitor className="size-5 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{device.name}</h1>
              <div className="mt-1 text-sm text-muted-foreground">
                <span className="font-mono">{device.id.slice(0, 8)}</span>
                {device.hostname && <span className="ml-2">· {device.hostname}</span>}
              </div>
              <div className={`mt-2 flex items-center gap-1.5 text-sm ${isOnline ? 'text-green-700' : 'text-muted-foreground'}`}>
                {isOnline ? (
                  <>
                    <Circle className="size-2 fill-green-600 text-green-600" />
                    <span>Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="size-4" />
                    <span>Offline · Last seen {lastSeenRelative}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => testConnectionMutation.mutate()}
              disabled={testConnectionMutation.isPending}
            >
              {testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateClientMutation.mutate()}
              disabled={updateClientMutation.isPending}
            >
              {updateClientMutation.isPending ? 'Updating...' : 'Update Client'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => restartAgentMutation.mutate()}
              disabled={restartAgentMutation.isPending}
            >
              {restartAgentMutation.isPending ? 'Restarting...' : 'Restart Agent'}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="jobs">Jobs <Badge variant="secondary" className="ml-1">{jobs.length}</Badge></TabsTrigger>
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* Status Card */}
            <Card className="border-l-2 border-l-orange-500">
              <div className="flex items-center justify-between px-5 h-11 border-b border-border">
                <h3>Status</h3>
                <div className={`flex items-center gap-1.5 ${isOnline ? 'text-green-700' : 'text-orange-700'}`}>
                  {isOnline ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5" />
                      Online
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Offline
                    </>
                  )}
                </div>
              </div>
              <dl className="divide-y divide-border">
                <div className="flex items-center px-5 h-10">
                  <dt className="text-muted-foreground w-40">Device status</dt>
                  <dd className={isOnline ? 'text-green-700' : 'text-red-700'}>{isOnline ? 'Online' : 'Offline'}</dd>
                </div>
                <div className="flex items-center px-5 h-10">
                  <dt className="text-muted-foreground w-40">Last seen</dt>
                  <dd className="text-foreground tabular-nums">{lastSeenRelative}</dd>
                </div>
                {device.agentVersion && (
                  <div className="flex items-center px-5 h-10">
                    <dt className="text-muted-foreground w-40">Agent version</dt>
                    <dd className="text-foreground tabular-nums">{device.agentVersion}</dd>
                  </div>
                )}
              </dl>
            </Card>

            {/* Critical Issues Card */}
            {!isOnline && (
              <Card className="border-l-2 border-l-red-500">
                <div className="flex items-center justify-between px-5 h-11 border-b border-border">
                  <h3>
                    Critical issues <span className="text-muted-foreground font-normal tabular-nums">(1)</span>
                  </h3>
                  <span className="text-muted-foreground">Device offline</span>
                </div>
                <ul className="divide-y divide-border">
                  <li className="flex items-start gap-3 px-5 py-3">
                    <Circle className="w-2 h-2 fill-red-600 text-red-600 mt-1.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-foreground">Device offline</div>
                      <div className="text-muted-foreground">Agent not responding · Last seen {lastSeenRelative}</div>
                    </div>
                  </li>
                </ul>
              </Card>
            )}

            {/* Summary Card */}
            <Card>
              <div className="grid grid-cols-3 divide-x divide-border">
                <div className="px-5 py-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Jobs on this device</div>
                  <div className="text-foreground tabular-nums">
                    {jobs.length} total
                  </div>
                </div>
                <div className="px-5 py-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Sync runs</div>
                  <div className="text-foreground tabular-nums">
                    {syncHistory.length} total
                  </div>
                </div>
                <div className="px-5 py-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Registered</div>
                  <div className="text-foreground tabular-nums">
                    {formatAbsolute(device.createdAt)}
                  </div>
                </div>
              </div>
            </Card>

            {/* Device Information */}
            <Card>
              <div className="flex items-center px-5 h-11 border-b border-border">
                <h3>Device information</h3>
              </div>
              <dl className="divide-y divide-border">
                {device.os && (
                  <div className="flex items-center px-5 h-10">
                    <dt className="text-muted-foreground w-32">OS</dt>
                    <dd className="text-foreground">{device.os}</dd>
                  </div>
                )}
                {device.hostname && (
                  <div className="flex items-center px-5 h-10">
                    <dt className="text-muted-foreground w-32">Hostname</dt>
                    <dd className="text-foreground font-mono">{device.hostname}</dd>
                  </div>
                )}
                {device.ipAddress && (
                  <div className="flex items-center px-5 h-10">
                    <dt className="text-muted-foreground w-32">IP address</dt>
                    <dd className="text-foreground font-mono tabular-nums">{device.ipAddress}</dd>
                  </div>
                )}
                <div className="flex items-center px-5 h-10">
                  <dt className="text-muted-foreground w-32">Device ID</dt>
                  <dd className="text-foreground font-mono">{device.id}</dd>
                </div>
                <div className="flex items-center px-5 h-10">
                  <dt className="text-muted-foreground w-32">Registered</dt>
                  <dd className="text-foreground tabular-nums">{formatAbsolute(device.createdAt)}</dd>
                </div>
              </dl>
            </Card>

            {/* Recent Activity */}
            {syncHistory.length > 0 && (
              <Card>
                <div className="flex items-center px-5 h-11 border-b border-border">
                  <h3>Recent activity</h3>
                </div>
                <div className="divide-y">
                  {syncHistory.slice(0, 5).map((log, index) => (
                    <div key={index} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-foreground">{log.jobName}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatAbsolute(log.started_at)}
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-xs capitalize">
                        {(log as any).status || 'completed'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </TabsContent>

          {/* Jobs Tab */}
          <TabsContent value="jobs" className="mt-4">
            <Card>
              <div className="flex items-center px-5 h-11 border-b border-border">
                <h3>Jobs on this device <span className="text-muted-foreground font-normal tabular-nums">({jobs.length})</span></h3>
              </div>
              {jobs.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No jobs configured for this device
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-border">
                      <tr>
                        <th className="text-left px-5 h-9 text-xs font-medium text-muted-foreground">
                          Job name
                        </th>
                        <th className="text-left px-5 h-9 text-xs font-medium text-muted-foreground">
                          Status
                        </th>
                        <th className="text-left px-5 h-9 text-xs font-medium text-muted-foreground">
                          Source → Destination
                        </th>
                        <th className="text-left px-5 h-9 text-xs font-medium text-muted-foreground">
                          Type
                        </th>
                        <th className="text-left px-5 h-9 text-xs font-medium text-muted-foreground">
                          Last run
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {jobs.map((job) => (
                        <tr key={job.id} className="hover:bg-muted/40 cursor-pointer transition-colors">
                          <td className="px-5 py-2.5">
                            <Link to={`/jobs/${job.id}`} className="text-foreground font-medium hover:underline">
                              {job.name}
                            </Link>
                          </td>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2">
                              <Circle
                                className={`size-2 flex-shrink-0 ${
                                  job.status === 'running' ? 'fill-green-600 text-green-600' :
                                  job.status === 'error' ? 'fill-red-600 text-red-600' :
                                  job.status === 'idle' ? 'fill-muted-foreground text-muted-foreground' :
                                  'fill-blue-600 text-blue-600'
                                }`}
                              />
                              <span className="text-xs capitalize">{job.status}</span>
                            </div>
                          </td>
                          <td className="px-5 py-2.5">
                            <code className="text-xs font-mono">
                              {job.source} → {job.destination}
                            </code>
                          </td>
                          <td className="px-5 py-2.5 text-xs capitalize">
                            {job.jobMode}
                          </td>
                          <td className="px-5 py-2.5 text-xs text-muted-foreground tabular-nums">
                            {job.lastRun ? formatRelative(job.lastRun) : 'Never'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Diagnostics Tab */}
          <TabsContent value="diagnostics" className="mt-4 space-y-4">
            {/* Disk Space */}
            <Card>
              <div className="flex items-center px-5 h-11 border-b border-border">
                <h3>Disk space</h3>
              </div>
              {diagnostics && diagnostics.diskDrives.length > 0 ? (
                <div className="divide-y">
                  {diagnostics.diskDrives.map((drive: any, index: number) => (
                    <div key={index} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground">{drive.name || 'Drive'}</div>
                        <div className="text-xs text-muted-foreground">
                          {drive.free || 0} GB free of {drive.total || 0} GB
                        </div>
                      </div>
                      <Badge
                        variant={drive.percentUsed && drive.percentUsed > 90 ? 'destructive' : 'outline'}
                        className="shrink-0 text-xs"
                      >
                        {drive.percentUsed || 0}% used
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No disk space data available
                </div>
              )}
            </Card>

            {/* Network Connectivity */}
            <Card>
              <div className="flex items-center px-5 h-11 border-b border-border">
                <h3>Network connectivity</h3>
              </div>
              {diagnostics && diagnostics.endpointChecks.length > 0 ? (
                <div className="divide-y">
                  {diagnostics.endpointChecks.map((check: any, index: number) => (
                    <div key={index} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground">{check.path || 'Endpoint'}</div>
                        <div className="text-xs text-muted-foreground">
                          Used in {check.usedIn || 0} jobs
                        </div>
                      </div>
                      <Badge
                        variant={check.status === 'ok' ? 'outline' : 'destructive'}
                        className="shrink-0 text-xs capitalize"
                      >
                        {check.status || 'unknown'}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No network connectivity data available
                </div>
              )}
            </Card>

            {/* Job Diagnostics */}
            <Card>
              <div className="flex items-center px-5 h-11 border-b border-border">
                <h3>Job diagnostics</h3>
              </div>
              {diagnostics && diagnostics.jobDiagnostics.length > 0 ? (
                <div className="divide-y">
                  {diagnostics.jobDiagnostics.map((diag: any, index: number) => (
                    <div key={index} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground">{diag.jobName || 'Job'}</div>
                        <div className="text-xs text-muted-foreground">
                          {diag.sourceIssue || 'No source issues'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {diag.destinationIssue || 'No destination issues'}
                        </div>
                      </div>
                      <Badge
                        variant={diag.status === 'ok' ? 'outline' : 'destructive'}
                        className="shrink-0 text-xs capitalize"
                      >
                        {diag.status || 'unknown'}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No job diagnostics data available
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs" className="mt-4">
            <Card>
              <div className="flex items-center justify-between px-5 h-11 border-b border-border">
                <h3>Sync History <span className="text-muted-foreground font-normal tabular-nums">({syncHistory.length})</span></h3>
              </div>
              {syncHistory.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No sync history yet
                </div>
              ) : (
                <div className="divide-y">
                  {syncHistory.map((log, index) => (
                    <Link
                      key={index}
                      to={`/jobs/${log.jobId}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground font-medium">{log.jobName}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatAbsolute(log.started_at)}
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-xs capitalize">
                        {(log as any).status || 'completed'}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  )
}
