// Formas dos dados retornados pela API do Nibo (validadas contra o uso real
// já feito no front-end da Anser — ver supabase/functions/nibo-* no repo
// anser-sete-insight, que serviram de referência para este cliente).

export interface NiboAccount {
  id: string
  name: string
  bankName?: string
  type?: string
  isArchived?: boolean
}

export interface NiboCategory {
  id: string
  name: string
  type?: 'in' | 'out'
  parentId?: string | null
  isDeleted?: boolean
}

export interface NiboCostCenter {
  id: string
  name?: string
  description?: string
  isDeleted?: boolean
}

export interface NiboScheduleCategory {
  id: string
  name: string
  type?: 'in' | 'out'
}

export interface NiboScheduleStakeholder {
  id: string
  name: string
  isDeleted?: boolean
}

export interface NiboSchedule {
  id: string
  scheduleDate?: string
  dueDate?: string
  description?: string
  value?: number
  openValue?: number
  paidValue?: number
  isPaid?: boolean
  isEntry?: boolean
  category?: NiboScheduleCategory
  costCenter?: { id: string; description?: string; name?: string }
  stakeholder?: NiboScheduleStakeholder
}

export interface NiboFirmCustomer {
  id: string
  name: string
  documentNumber?: string
  code?: string
  createdAt?: string
}

export interface NiboFirmTask {
  id: string
  name: string
  description?: string
  deadLine?: string
  status?: number
  completedAt?: string | null
  customer?: { id: string; name: string }
  inChargeUser?: { id: string; name: string }
}

export interface NiboListResponse<T> {
  items?: T[]
  value?: T[]
  totalItems?: number
}
