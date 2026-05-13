declare module 'ssh2-sftp-client' {
  import type { Readable } from 'stream'

  interface ConnectOptions {
    host: string
    port?: number
    username?: string
    password?: string
    readyTimeout?: number
  }

  namespace SftpClient {
    interface FileInfo {
      type: '-' | 'd' | 'l'
      name: string
      size: number
      modifyTime: number
    }
  }

  class SftpClient {
    constructor(clientName?: string)
    connect(options: ConnectOptions): Promise<void>
    end(): Promise<void>
    list(remoteFilePath: string): Promise<SftpClient.FileInfo[]>
    exists(remotePath: string): Promise<boolean | 'd' | '-' | 'l'>
    mkdir(remotePath: string, recursive?: boolean): Promise<string>
    createReadStream(remotePath: string): Readable
    put(input: Readable | NodeJS.ReadableStream | Buffer | string, remotePath: string): Promise<string>
  }

  export = SftpClient
}
