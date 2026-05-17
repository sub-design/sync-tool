import type { CollisionPolicy, ConflictStrategy, DateSource, DeletionPolicy, DestinationLayout, JobDirection, JobFilters, JobMode, JobTemplateDefaults, TransferMode } from '@/types'

export type JobPresetId = 'photo-import' | 'mirror-backup' | 'two-way-sync' | 'developer-files'
export type JobPresetIcon = 'images' | 'copy' | 'sync' | 'code'

export interface JobPresetDefaults extends JobTemplateDefaults {
  name?: string
  jobMode?: JobMode
  direction?: JobDirection
  transferMode?: TransferMode
  conflictStrategy?: ConflictStrategy
  deletionPolicy?: DeletionPolicy
  filters?: JobFilters
  destinationLayout?: DestinationLayout
  dateSource?: DateSource
  collisionPolicy?: CollisionPolicy
  encryptionEnabled?: boolean
}

export interface JobPreset {
  id: JobPresetId
  name: string
  description: string
  icon: JobPresetIcon
  defaults: JobPresetDefaults
}

export const JOB_PRESETS: JobPreset[] = [
  {
    id: 'photo-import',
    name: 'Photo Import',
    description: 'Copy photos and videos into capture-date folders without renaming files.',
    icon: 'images',
    defaults: {
      name: 'Photo Import',
      jobMode: 'import',
      direction: 'ltr',
      transferMode: 'full',
      deletionPolicy: 'backup',
      destinationLayout: 'byCaptureDate',
      dateSource: 'exifThenMtime',
      collisionPolicy: 'skipSameErrorDifferent',
      encryptionEnabled: false,
    },
  },
  {
    id: 'mirror-backup',
    name: 'Mirror Backup',
    description: 'Make the destination match the source. Source-side changes win.',
    icon: 'copy',
    defaults: {
      name: 'Mirror Backup',
      jobMode: 'sync',
      direction: 'ltr',
      transferMode: 'auto',
      deletionPolicy: 'mirror',
      encryptionEnabled: true,
    },
  },
  {
    id: 'two-way-sync',
    name: 'Two-way Sync',
    description: 'Keep both folders synchronized and resolve conflicts with newer files.',
    icon: 'sync',
    defaults: {
      name: 'Two-way Sync',
      jobMode: 'sync',
      direction: 'bidir',
      transferMode: 'auto',
      conflictStrategy: 'newer-wins',
      deletionPolicy: 'backup',
      encryptionEnabled: true,
    },
  },
  {
    id: 'developer-files',
    name: 'Developer Files',
    description: 'Sync project files while ignoring dependency, build, and VCS folders.',
    icon: 'code',
    defaults: {
      name: 'Developer Files',
      jobMode: 'sync',
      direction: 'bidir',
      transferMode: 'auto',
      conflictStrategy: 'newer-wins',
      deletionPolicy: 'backup',
      encryptionEnabled: true,
      filters: {
        exclude: [
          'node_modules/**',
          '.git/**',
          'dist/**',
          'build/**',
          '.next/**',
          'coverage/**',
        ],
        excludeSystem: true,
      },
    },
  },
]

export function getJobPreset(id: JobPresetId | null): JobPreset | undefined {
  return JOB_PRESETS.find((preset) => preset.id === id)
}
