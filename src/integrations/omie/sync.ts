import type { SyncReport } from '../types.js'

// Esqueleto — seguir o mesmo padrão de src/integrations/nibo/sync.ts quando
// o client.ts do Omie estiver implementado: uma função syncCompanyOmie(companyId,
// credentials) que busca cada recurso, faz upsert em uma tabela omie_<recurso>
// (ver schema.sql) e grava o resultado em sync_logs via runResource/logSync.

export async function syncCompanyOmie(companyId: string): Promise<SyncReport> {
  throw new Error(`syncCompanyOmie não implementado ainda (company=${companyId})`)
}
