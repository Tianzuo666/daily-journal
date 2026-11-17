import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Attachment } from './domain'

export interface BackupFile { path: string; name: string; createdAt: number; size: number }
export interface StagedBackup { token: string; manifest: string }
interface JournalFilesPlugin {
  info(): Promise<{ imageDirectory: string; backups: BackupFile[] }>
  pickImages(): Promise<{ images: Attachment[]; cancelled?: boolean }>
  createBackup(options: { manifest: string }): Promise<BackupFile>
  setSystemBars(options: { background: string; darkIcons: boolean }): Promise<void>
  exportFile(options: { path: string; name: string; mime: string }): Promise<{ cancelled?: boolean }>
  chooseBackup(): Promise<StagedBackup & { cancelled?: boolean }>
  installImages(options: { token: string }): Promise<void>
  removeImages(options: { images: string[] }): Promise<void>
  discardStage(options: { token: string }): Promise<void>
  createTextExport(options: { name: string; content: string }): Promise<{ path: string }>
  createNotesExport(options: { notes: string }): Promise<{ path: string }>
}
export const native = Capacitor.getPlatform() === 'android'
export const files = registerPlugin<JournalFilesPlugin>('JournalFiles')
export const imageUrl = (directory: string, file: string) => Capacitor.convertFileSrc(`${directory}/${file}`)
