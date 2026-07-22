function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL')
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY')
  },
  get hubApiKey() {
    return required('HUB_API_KEY')
  },
  get cronSecret() {
    return process.env.CRON_SECRET || ''
  },
  get niboAccountantApiKey() {
    return process.env.NIBO_ACCOUNTANT_API_KEY || ''
  },
  get niboAccountantFirmId() {
    return process.env.NIBO_ACCOUNTANT_FIRM_ID || ''
  },
}
