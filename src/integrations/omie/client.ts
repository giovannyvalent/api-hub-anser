import type { OmieCredentials } from './types.js'

// Esqueleto do cliente Omie — segue o mesmo padrão do NiboEmpresaClient
// (src/integrations/nibo/client.ts): uma classe por credencial, um método por
// recurso. A API do Omie é toda via POST em endpoints por módulo, com o corpo:
//   { call: "<Método>", app_key, app_secret, param: [{...}] }
// Docs: https://developer.omie.com.br/
//
// Implementar aqui quando tivermos credenciais de teste. Endpoints comuns:
//  - Clientes:        POST https://app.omie.com.br/api/v1/geral/clientes/       call=ListarClientes
//  - Contas a pagar:  POST https://app.omie.com.br/api/v1/financas/contapagar/  call=ListarContasPagar
//  - Contas a receber:POST https://app.omie.com.br/api/v1/financas/contareceber/call=ListarContasReceber

export class OmieClient {
  constructor(private credentials: OmieCredentials) {}

  async listClientes(): Promise<never> {
    throw new Error('OmieClient.listClientes: não implementado ainda — ver TODO em client.ts')
  }
}
