export interface SyncResourceResult {
  resource: string
  recordsSynced: number
  error?: string
}

export interface SyncReport {
  platform: string
  companyId: string | null
  results: SyncResourceResult[]
  startedAt: string
  finishedAt: string
}
