import nodemailer from 'nodemailer'
import type { Job, SyncResult } from '@sync-tool/shared'

type NotificationEvent =
  | { status: 'completed'; result: SyncResult }
  | { status: 'cancelled'; jobId: string }
  | { status: 'error'; jobId: string; error: string }

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
        : undefined,
    })
  : undefined

export async function notifyJob(job: Job | undefined, event: NotificationEvent): Promise<void> {
  if (!job) return

  await Promise.allSettled([
    sendEmail(job, event),
    sendWebhook(job, event),
  ])
}

async function sendEmail(job: Job, event: NotificationEvent): Promise<void> {
  const to = job.reliability?.notifyEmail
  if (!to || !mailer) return

  const subject = `[sync-tool] ${job.name}: ${event.status}`
  await mailer.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'sync-tool@localhost',
    to,
    subject,
    text: notificationText(job, event),
  })
}

async function sendWebhook(job: Job, event: NotificationEvent): Promise<void> {
  const url = job.reliability?.notifyWebhookUrl
  if (!url) return

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      job: {
        id: job.id,
        name: job.name,
        source: job.source,
        destination: job.destination,
      },
      event,
      sentAt: Date.now(),
    }),
  })
  if (!response.ok) throw new Error(`webhook failed with HTTP ${response.status}`)
}

function notificationText(job: Job, event: NotificationEvent): string {
  if (event.status === 'completed') {
    return [
      `Job: ${job.name}`,
      `Status: completed`,
      `Copied: ${event.result.filesCopied}`,
      `Skipped: ${event.result.filesSkipped}`,
      `Errors: ${event.result.filesErrored}`,
      `Bytes transferred: ${event.result.bytesTransferred}`,
    ].join('\n')
  }

  if (event.status === 'error') {
    return [`Job: ${job.name}`, `Status: error`, `Error: ${event.error}`].join('\n')
  }

  return [`Job: ${job.name}`, `Status: cancelled`].join('\n')
}
