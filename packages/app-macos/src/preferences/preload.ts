import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('syncTool', {
  getConfig: (): Promise<{
    apiUrl:     string
    agentToken: string
    deviceId:   string
    deviceName: string
    email?:     string
  }> => ipcRenderer.invoke('config:get'),

  login: (params: {
    apiUrl:     string
    email:      string
    password:   string
    deviceName: string
  }): Promise<{ email: string }> => ipcRenderer.invoke('config:login', params),

  signOut: (): Promise<void> => ipcRenderer.invoke('config:signout'),

  saveDeviceName: (deviceName: string): Promise<void> =>
    ipcRenderer.invoke('config:save-device-name', deviceName),

  close: (): void => ipcRenderer.send('preferences:close'),
})
