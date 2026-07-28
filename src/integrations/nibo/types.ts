// Formas dos dados retornados pela API do Nibo — validadas em chamadas reais
// contra api.nibo.com.br (não apenas a documentação, que às vezes omite campos).

export interface NiboAccount {
  id: string
  name: string
  openBalance?: number
  dateOfOpenBalance?: string
  isVirtual?: boolean
  type?: string
  isReconcilable?: boolean
  isArchived?: boolean
  updateDate?: string
  updateUser?: string
  bankId?: string
  bankName?: string
  bankAgency?: string
  bankAccount?: string
  bankNumber?: number
  isAutomated?: boolean
  isOpenFinance?: boolean
}

export interface NiboAccountBalance {
  accountId: string
  accountName: string
  balance: number
  agency?: string
  accountNumber?: string
  isVirtual?: boolean
  isReconcilable?: boolean
  bank?: { id: string; code: string; name: string }
  pendingReconciliationCount?: number
  totalOpenReconciliations?: number
  bankBalance?: number
  bankBalanceChangedDate?: string
  isAccountAutomated?: boolean
}

// GET /accounts/{accountId}/views/statement — extrato real (ledger), diferente
// de "schedules" (que é o agendado/competência, contas a pagar/receber).
export interface NiboStatementEntry {
  index: number
  entryId?: string
  stakeholderId?: string
  stakeholderName?: string
  stakeholderIsDeleted?: boolean
  value: number
  date: string
  createDate?: string
  currentBalance: number
  isTransfer?: boolean
  transferId?: string
  type: string // "StartAccountBalance" | "Transfer" | "Entry" | ...
  isReconciliated?: boolean
  description?: string
  categoryName?: string
  categoryId?: string
}

export interface NiboCategory {
  id: string
  name: string
  order?: number
  type?: 'in' | 'out'
  group?: { id: string; name: string; referenceCode?: string }
  subgroupId?: string
  subgroupName?: string
  isEditable?: boolean
  groupType?: number
  isDeleted?: boolean
}

export interface NiboCostCenter {
  costCenterId: string
  description?: string
  updateDate?: string
  updateUser?: string
  isDeleted?: boolean
}

// customers, suppliers, partners e employees compartilham exatamente esta
// forma na API do Nibo — só o endpoint (e o campo "type") muda.
export interface NiboStakeholder {
  id: string
  personType?: number
  isDeleted?: boolean
  isArchived?: boolean
  isCompany?: boolean
  name: string
  initialsName?: string
  email?: string
  document?: { number?: string; type?: string }
  communication?: { email?: string; phone?: string }
  address?: Record<string, unknown>
  bankAccountInformation?: Record<string, unknown>
  companyInformation?: { companyName?: string }
  type: 'Customer' | 'Supplier' | 'Partner' | 'Employee'
  updateDate?: string
  updateUser?: string
}

export type NiboStakeholderKind = 'customer' | 'supplier' | 'partner' | 'employee'

export interface NiboScheduleCategorySplit {
  id: string
  categoryId: string
  categoryName: string
  value: number
  type?: 'in' | 'out'
  parent?: string
  parentId?: string
  isDeleted?: boolean
}

export interface NiboScheduleCostCenterSplit {
  costCenterId: string
  percent: number
  value: number
  costCenterDescription?: string
  isDeleted?: boolean
}

// GET /schedules/debit (contas a pagar) e /schedules/credit (contas a receber).
export interface NiboSchedule {
  scheduleId: string
  type: 'Debit' | 'Credit'
  isEntry?: boolean
  isBill?: boolean
  isDebitNote?: boolean
  isFlagged?: boolean
  isDued?: boolean
  dueDate?: string
  accrualDate?: string
  scheduleDate?: string
  createDate?: string
  createUser?: string
  updateDate?: string
  updateUser?: string
  value?: number
  isPaid?: boolean
  paidValue?: number
  openValue?: number
  stakeholder?: { id: string; name: string; isDeleted?: boolean; type?: string; cpfCnpj?: string }
  description?: string
  reference?: string
  category?: { id: string; name: string; isDeleted?: boolean; type?: 'in' | 'out' }
  categories?: NiboScheduleCategorySplit[]
  costCenter?: { id: string; description?: string; isDeleted?: boolean }
  costCenters?: NiboScheduleCostCenterSplit[]
  hasInstallment?: boolean
  hasRecurrence?: boolean
  recurrence?: Record<string, unknown>
  hasInvoice?: boolean
  isPaymentScheduled?: boolean
}

export interface NiboOrganization {
  organizationId: string
  name: string
  cnpj?: string
  invoiceEnabled?: number
  plan?: string
  subscriptionPlan?: string
  accountantId?: string
  accountantName?: string
  type?: number
  address?: Record<string, unknown>
  features?: { key: string }[]
  users?: { userId: string; email: string; name: string; isOwner: boolean }[]
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
  count?: number
  totalItems?: number
}
