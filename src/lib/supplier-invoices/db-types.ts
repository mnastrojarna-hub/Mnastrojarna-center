// Řádky tabulek faktur dodavatelů (migrace 20261029110000_faktury_dodavatelu.sql).

export type SupplierInvoicePaymentStatus = "nezaplaceno" | "castecne" | "zaplaceno";
export type SupplierInvoiceStatus = "nahrano" | "ke_kontrole" | "zpracovano" | "zamitnuto";
export type SupplierInvoiceSource = "photo" | "scan" | "upload" | "email";
export type SupplierInvoiceTarget = "job" | "rezie";
export type OverheadCategory = "doprava" | "naradi" | "energie" | "material" | "sluzby" | "ostatni";

export interface SupplierInvoiceRow {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_ico: string | null;
  supplier_dic: string | null;
  supplier_address: string | null;
  supplier_bank_account: string | null;
  supplier_email: string | null;
  supplier_phone: string | null;
  number: string | null;
  variable_symbol: string | null;
  issue_date: string | null;
  taxable_date: string | null;
  due_date: string | null;
  currency: string;
  exchange_rate: number | null;
  total_net: number | null;
  total_vat: number | null;
  total_gross: number | null;
  payment_status: SupplierInvoicePaymentStatus;
  paid_amount: number | null;
  paid_at: string | null;
  paid_by: string | null;
  status: SupplierInvoiceStatus;
  source: SupplierInvoiceSource;
  email_id: string | null;
  capture_key: string | null;
  duplicate_of_id: string | null;
  content_sha256: string | null;
  is_credit_note: boolean;
  /** Zálohová (proforma) faktura — do nákladů zakázek se nepočítá. */
  is_proforma: boolean;
  /** Objednávky dodavatelům, které faktura uzavírá („Faktura konečná"). */
  final_po_ids: string[];
  ai_extracted: Record<string, unknown> | null;
  ai_confidence: number | null;
  ai_used: boolean;
  ai_error: string | null;
  ai_processed_at: string | null;
  note: string | null;
  uploaded_by: string | null;
  updated_by: string | null;
  processed_by: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Generované (jen čtení). */
  number_norm: string;
  supplier_key: string | null;
}

export interface SupplierInvoiceFileRow {
  id: string;
  invoice_id: string;
  position: number;
  storage_path: string;
  filename: string;
  mime_type: string | null;
  size: number | null;
  sha256: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface SupplierInvoiceItemRow {
  id: string;
  invoice_id: string;
  position: number;
  text: string;
  code: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number;
  vat_rate: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierInvoiceAllocationRow {
  id: string;
  invoice_id: string;
  item_id: string | null;
  target: SupplierInvoiceTarget;
  job_id: string | null;
  overhead_category: OverheadCategory | null;
  amount: number;
  purchase_order_id: string | null;
  purchase_order_item_id: string | null;
  order_item_id: string | null;
  note: string | null;
  ai_suggested: boolean;
  ai_reason: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  position: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}
