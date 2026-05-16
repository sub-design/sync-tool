import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Trash2, ChevronDown } from 'lucide-react'
import Shell from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { orgsApi, type MemberWithEmail } from '@/lib/orgs'
import type { OrgRole } from '@/types'

const ROLE_LABELS: Record<OrgRole, string> = {
  owner:  'Owner',
  admin:  'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

const ASSIGNABLE_ROLES: OrgRole[] = ['admin', 'member', 'viewer']

export default function OrgSettings() {
  const qc = useQueryClient()

  const { data: org, isLoading } = useQuery({
    queryKey: ['org-current'],
    queryFn:  orgsApi.getCurrent,
  })

  // ── Invite dialog ─────────────────────────────────────────────────────────

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgRole>('member')
  const [inviteError, setInviteError] = useState('')

  const inviteMutation = useMutation({
    mutationFn: () => orgsApi.addMember(inviteEmail, inviteRole),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-current'] })
      setInviteOpen(false)
      setInviteEmail('')
      setInviteRole('member')
      setInviteError('')
    },
    onError: (err: Error) => setInviteError(err.message),
  })

  // ── Remove member ─────────────────────────────────────────────────────────

  const [removeTarget, setRemoveTarget] = useState<MemberWithEmail | null>(null)

  const removeMutation = useMutation({
    mutationFn: (userId: string) => orgsApi.removeMember(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-current'] })
      setRemoveTarget(null)
    },
  })

  // ── Change role ───────────────────────────────────────────────────────────

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      orgsApi.updateMemberRole(userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-current'] }),
  })

  if (isLoading) return <Shell><p className="text-muted-foreground text-sm">Loading…</p></Shell>

  const members = org?.members ?? []

  return (
    <Shell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{org?.name}</h1>
            <p className="text-sm text-muted-foreground">
              Plan: <span className="capitalize">{org?.plan}</span>
              {' · '}
              {members.length} member{members.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus size={14} className="mr-1.5" />
            Invite member
          </Button>
        </div>

        <div className="border rounded-md divide-y">
          {members.map(member => (
            <div key={member.userId} className="flex items-center justify-between px-4 py-3">
              <div className="text-sm">
                <p className="font-medium">{member.email}</p>
                <p className="text-muted-foreground text-xs">
                  Joined {new Date(member.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {member.role === 'owner' ? (
                  <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                        {ROLE_LABELS[member.role]}
                        <ChevronDown size={12} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {ASSIGNABLE_ROLES.map(role => (
                        <DropdownMenuItem
                          key={role}
                          onClick={() => roleMutation.mutate({ userId: member.userId, role })}
                          className={member.role === role ? 'font-medium' : ''}
                        >
                          {ROLE_LABELS[role]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {member.role !== 'owner' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setRemoveTarget(member)}
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <div className="flex gap-2">
                {ASSIGNABLE_ROLES.map(role => (
                  <Button
                    key={role}
                    variant={inviteRole === role ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setInviteRole(role)}
                  >
                    {ROLE_LABELS[role]}
                  </Button>
                ))}
              </div>
            </div>
            {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button
              onClick={() => inviteMutation.mutate()}
              disabled={!inviteEmail || inviteMutation.isPending}
            >
              {inviteMutation.isPending ? 'Inviting…' : 'Invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirm */}
      <AlertDialog open={!!removeTarget} onOpenChange={open => { if (!open) setRemoveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{removeTarget?.email}</strong> from this organization?
              They will lose access to all jobs and endpoints.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.userId)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  )
}
