// TODO: preencher com as formas reais dos recursos do Omie assim que
// tivermos credenciais de teste (appKey/appSecret) e o mapeamento de campos.
// A API do Omie usa POST com corpo { call, app_key, app_secret, param: [...] }
// em vez de REST/OData como o Nibo — ver client.ts.

export interface OmieCredentials {
  appKey: string
  appSecret: string
}
