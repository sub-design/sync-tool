import path from 'path'
import os from 'os'

export const STATE_DIR = process.env.STATE_DIR
  ?? (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'SyncTool')
      : path.join(os.homedir(), '.synctool'))
