import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { StorageBackend, FileEntry, FileMeta, WriteOptions } from '../sync'

export class S3Backend implements StorageBackend {
  private client: S3Client
  readonly bucket: string
  readonly keyPrefix: string  // stored without leading/trailing slashes

  constructor(urlStr: string) {
    const url = new URL(urlStr)
    this.bucket    = url.hostname
    this.keyPrefix = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '')

    const region   = url.searchParams.get('region')   ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1'
    const endpoint = url.searchParams.get('endpoint') ?? process.env.S3_ENDPOINT

    // Credentials can be embedded as username:password in the URI
    // (set by the API when resolving a Named Endpoint at run time)
    const accessKeyId     = url.username ? decodeURIComponent(url.username) : undefined
    const secretAccessKey = url.password ? decodeURIComponent(url.password) : undefined

    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    })
  }

  async walk(rootPath: string): Promise<Map<string, FileEntry>> {
    // rootPath is the prefix (from createS3Backend.rootPath); normalise it.
    const prefix    = rootPath.replace(/^\/+/, '').replace(/\/+$/, '')
    const listPrefix = prefix ? `${prefix}/` : ''
    const entries   = new Map<string, FileEntry>()
    let   token: string | undefined

    do {
      const resp = await this.client.send(new ListObjectsV2Command({
        Bucket:            this.bucket,
        Prefix:            listPrefix,
        ContinuationToken: token,
      }))

      for (const obj of resp.Contents ?? []) {
        if (!obj.Key || obj.Key.endsWith('/')) continue   // skip directory markers
        const rel = obj.Key.slice(listPrefix.length)
        if (!rel) continue
        entries.set(rel, {
          relativePath: rel,
          absolutePath: obj.Key,
          size:         obj.Size     ?? 0,
          mtimeMs:      obj.LastModified?.getTime() ?? 0,
          isDirectory:  false,
        })
      }

      token = resp.NextContinuationToken
    } while (token)

    return entries
  }

  async mkdirp(_dirPath: string): Promise<void> {
    // S3 has no real directories — nothing to create.
  }

  async read(filePath: string): Promise<NodeJS.ReadableStream> {
    const resp = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key:    s3Key(filePath),
    }))
    return resp.Body as NodeJS.ReadableStream
  }

  async write(filePath: string, stream: NodeJS.ReadableStream, meta: FileMeta, options: WriteOptions = {}): Promise<void> {
    const finalKey   = s3Key(filePath)
    const uploadKey  = options.atomic ? `${finalKey}.sync-tool-part` : finalKey
    const metadata   = { mtime: String(meta.mtimeMs) }

    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: uploadKey, Body: stream as any, Metadata: metadata },
    }).done()

    if (options.atomic) {
      await this.client.send(new CopyObjectCommand({
        Bucket:            this.bucket,
        CopySource:        `${this.bucket}/${uploadKey}`,
        Key:               finalKey,
        Metadata:          metadata,
        MetadataDirective: 'REPLACE',
      }))
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: uploadKey }))
    }
  }

  async delete(filePath: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key:    s3Key(filePath),
    }))
  }

  async move(fromPath: string, toPath: string, meta: FileMeta): Promise<void> {
    const fromKey = s3Key(fromPath)
    const toKey   = s3Key(toPath)
    await this.client.send(new CopyObjectCommand({
      Bucket:            this.bucket,
      CopySource:        `${this.bucket}/${fromKey}`,
      Key:               toKey,
      Metadata:          { mtime: String(meta.mtimeMs) },
      MetadataDirective: 'REPLACE',
    }))
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: fromKey }))
  }
}

export function createS3Backend(urlStr: string): { backend: S3Backend; rootPath: string } {
  const url    = new URL(urlStr)
  const prefix = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  return {
    backend:  new S3Backend(urlStr),
    rootPath: prefix || '/',
  }
}

// Strip leading slashes — S3 keys must not start with '/'.
function s3Key(filePath: string): string {
  return filePath.replace(/^\/+/, '')
}
