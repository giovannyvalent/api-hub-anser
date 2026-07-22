export interface SyncResourceResult {
  resource: string
  recordsSynced: number
}

export interface SyncReport {
  platform: string
  companyId: string | null
  results: SyncResourceResult[]
  startedAt: string
  finishedAt: string
}
