import { Apple, Download, ArrowRight, Shield, FolderOpen, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

const DMG_URL =
  'https://github.com/sub-design/sync-tool/releases/latest/download/Sync.Tool-0.1.0-arm64.dmg'

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b px-6 py-4 flex items-center gap-3">
        <div className="size-7 rounded-md bg-primary flex items-center justify-center">
          <Zap size={14} className="text-primary-foreground" />
        </div>
        <span className="font-semibold text-sm">Sync Tool</span>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center gap-8">
        <div className="flex flex-col items-center gap-4 max-w-xl">
          <div className="size-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Apple size={40} className="text-primary" />
          </div>

          <h1 className="text-4xl font-bold tracking-tight">
            Sync Tool for macOS
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Lightweight menu bar app that keeps your files in sync with remote
            servers over SFTP/FTP — quietly running in the background.
          </p>
        </div>

        {/* Download button */}
        <a href={DMG_URL} download>
          <Button size="lg" className="gap-2 px-8 text-base h-12">
            <Download size={18} />
            Download for macOS
          </Button>
        </a>
        <p className="text-xs text-muted-foreground">
          Version 0.1.0 · Universal (Apple Silicon + Intel) · macOS 13+
        </p>

        {/* Install steps */}
        <div className="mt-4 w-full max-w-md text-left rounded-xl border bg-card p-6 flex flex-col gap-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Installation
          </h2>

          {[
            {
              icon: <FolderOpen size={16} />,
              title: 'Open the DMG',
              desc: 'Double-click the downloaded .dmg file.',
            },
            {
              icon: <ArrowRight size={16} />,
              title: 'Drag to Applications',
              desc: 'Drag Sync Tool into your Applications folder.',
            },
            {
              icon: <Apple size={16} />,
              title: 'Launch the app',
              desc: 'Open it from Applications or Spotlight. Look for the icon in your menu bar.',
            },
            {
              icon: <Shield size={16} />,
              title: 'Allow unsigned app',
              desc: (
                <>
                  On first launch macOS may block it. Go to{' '}
                  <span className="font-medium">
                    System Settings → Privacy &amp; Security
                  </span>{' '}
                  and click <span className="font-medium">Open Anyway</span>.
                </>
              ),
            },
          ].map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="mt-0.5 shrink-0 size-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                {step.icon}
              </div>
              <div>
                <p className="font-medium text-sm">{step.title}</p>
                <p className="text-sm text-muted-foreground">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <a href="/login" className="underline underline-offset-4 hover:text-foreground transition-colors">
            Sign in
          </a>
        </p>
      </main>
    </div>
  )
}
