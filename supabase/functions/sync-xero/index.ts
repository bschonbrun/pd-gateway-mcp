import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function dbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  };
}

async function upsert(table: string, rows: unknown[]): Promise<number> {
  if (!rows.length) return 0;
  const allKeys = new Set<string>();
  (rows as Record<string,unknown>[]).forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  const normalized = (rows as Record<string,unknown>[]).map(r => {
    const out: Record<string,unknown> = {};
    allKeys.forEach(k => { out[k] = r[k] ?? null; });
    return out;
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify(normalized),
  });
  if (!res.ok) throw new Error(`upsert ${table} failed: ${await res.text()}`);
  return rows.length;
}

// ── Date helpers ─────────────────────────────────────────────────────────────
function parseXeroDate(val: string | undefined | null): string | null {
  if (!val) return null;
  const ms = val.match(/\/Date\((\d+)([+-]\d+)?\)\//);
  if (ms) return new Date(parseInt(ms[1])).toISOString().split('T')[0];
  return val.split('T')[0] ?? null;
}

function parseXeroTimestamp(val: string | undefined | null): string | null {
  if (!val) return null;
  const ms = val.match(/\/Date\((\d+)([+-]\d+)?\)\//);
  if (ms) return new Date(parseInt(ms[1])).toISOString();
  return val;
}

// ── AP Bills ──────────────────────────────────────────────────────────────────
function mapBill(b: Record<string,unknown>, tenantId: string, companyName: string) {
  const contact = (b.Contact as Record<string,unknown>) ?? {};
  return {
    id: b.InvoiceID,
    xero_tenant_id: tenantId,
    company_name: companyName,
    invoice_number: b.InvoiceNumber ?? null,
    contact_id: contact.ContactID ?? null,
    contact_name: contact.Name ?? null,
    status: b.Status ?? null,
    invoice_date: parseXeroDate(b.DateString as string ?? b.Date as string),
    due_date: parseXeroDate(b.DueDateString as string ?? b.DueDate as string),
    fully_paid_on_date: parseXeroDate(b.FullyPaidOnDate as string),
    expected_payment_date: parseXeroDate(b.ExpectedPaymentDate as string),
    planned_payment_date: parseXeroDate(b.PlannedPaymentDate as string),
    total: b.Total ?? null,
    amount_due: b.AmountDue ?? null,
    amount_paid: b.AmountPaid ?? null,
    amount_credited: b.AmountCredited ?? null,
    sub_total: b.SubTotal ?? null,
    total_tax: b.TotalTax ?? null,
    currency_code: b.CurrencyCode ?? null,
    currency_rate: b.CurrencyRate ?? null,
    reference: b.Reference ?? null,
    url: b.Url ?? null,
    has_attachments: b.HasAttachments ?? null,
    repeating_invoice_id: b.RepeatingInvoiceID ?? null,
    synced_at: new Date().toISOString(),
  };
}

function mapBillLineItems(b: Record<string,unknown>, billId: string) {
  return ((b.LineItems as unknown[]) ?? []).map((li: unknown) => {
    const l = li as Record<string,unknown>;
    const tracking = ((l.Tracking as unknown[]) ?? [])[0] as Record<string,unknown> | undefined;
    return {
      id: l.LineItemID ?? `${billId}-${Math.random()}`,
      bill_id: billId,
      description: l.Description ?? null,
      quantity: l.Quantity ?? null,
      unit_amount: l.UnitAmount ?? null,
      line_amount: l.LineAmount ?? null,
      account_code: l.AccountCode ?? null,
      tax_type: l.TaxType ?? null,
      item_code: l.ItemCode ?? null,
      discount_rate: l.DiscountRate ?? null,
      discount_amount: l.DiscountAmount ?? null,
      tracking_name: tracking?.Name ?? null,
      tracking_option: tracking?.Option ?? null,
    };
  });
}

// ── AR Invoices ───────────────────────────────────────────────────────────────
function mapArInvoice(inv: Record<string,unknown>, tenantId: string, companyName: string) {
  const contact = (inv.Contact as Record<string,unknown>) ?? {};
  return {
    id: inv.InvoiceID,
    xero_tenant_id: tenantId,
    company_name: companyName,
    invoice_number: inv.InvoiceNumber ?? null,
    contact_id: contact.ContactID ?? null,
    contact_name: contact.Name ?? null,
    status: inv.Status ?? null,
    invoice_date: parseXeroDate(inv.DateString as string ?? inv.Date as string),
    due_date: parseXeroDate(inv.DueDateString as string ?? inv.DueDate as string),
    fully_paid_on_date: parseXeroDate(inv.FullyPaidOnDate as string),
    expected_payment_date: parseXeroDate(inv.ExpectedPaymentDate as string),
    planned_payment_date: parseXeroDate(inv.PlannedPaymentDate as string),
    total: inv.Total ?? null,
    amount_due: inv.AmountDue ?? null,
    amount_paid: inv.AmountPaid ?? null,
    amount_credited: inv.AmountCredited ?? null,
    sub_total: inv.SubTotal ?? null,
    total_tax: inv.TotalTax ?? null,
    currency_code: inv.CurrencyCode ?? null,
    currency_rate: inv.CurrencyRate ?? null,
    reference: inv.Reference ?? null,
    url: inv.Url ?? null,
    sent_to_contact: inv.SentToContact ?? null,
    has_attachments: inv.HasAttachments ?? null,
    repeating_invoice_id: inv.RepeatingInvoiceID ?? null,
    synced_at: new Date().toISOString(),
  };
}

function mapArLineItems(inv: Record<string,unknown>, invoiceId: string) {
  return ((inv.LineItems as unknown[]) ?? []).map((li: unknown) => {
    const l = li as Record<string,unknown>;
    const tracking = ((l.Tracking as unknown[]) ?? [])[0] as Record<string,unknown> | undefined;
    return {
      id: l.LineItemID ?? `${invoiceId}-${Math.random()}`,
      invoice_id: invoiceId,
      description: l.Description ?? null,
      quantity: l.Quantity ?? null,
      unit_amount: l.UnitAmount ?? null,
      line_amount: l.LineAmount ?? null,
      account_code: l.AccountCode ?? null,
      tax_type: l.TaxType ?? null,
      item_code: l.ItemCode ?? null,
      discount_rate: l.DiscountRate ?? null,
      discount_amount: l.DiscountAmount ?? null,
      tracking_name: tracking?.Name ?? null,
      tracking_option: tracking?.Option ?? null,
    };
  });
}

// ── Invoice Payments ──────────────────────────────────────────────────────────
function mapInvoicePayments(
  invoice: Record<string,unknown>,
  invoiceId: string,
  invoiceType: 'AR' | 'AP',
  tenantId: string,
  companyName: string
) {
  return ((invoice.Payments as unknown[]) ?? []).map((p: unknown) => {
    const pay = p as Record<string,unknown>;
    const account = (pay.Account as Record<string,unknown>) ?? {};
    return {
      id: pay.PaymentID,
      invoice_id: invoiceId,
      invoice_type: invoiceType,
      xero_tenant_id: tenantId,
      company_name: companyName,
      date: parseXeroDate(pay.DateString as string ?? pay.Date as string),
      amount: pay.Amount ?? null,
      bank_amount: pay.BankAmount ?? null,
      currency_rate: pay.CurrencyRate ?? null,
      reference: pay.Reference ?? null,
      payment_type: pay.PaymentType ?? null,
      account_id: account.AccountID ?? null,
      account_code: account.Code ?? null,
      account_name: account.Name ?? null,
      is_reconciled: pay.IsReconciled ?? null,
      synced_at: new Date().toISOString(),
    };
  });
}

// ── GL Journals ───────────────────────────────────────────────────────────────
function mapJournal(j: Record<string,unknown>, tenantId: string, companyName: string) {
  return {
    journal_id: j.JournalID,
    xero_tenant_id: tenantId,
    company_name: companyName,
    journal_date: parseXeroDate(j.JournalDateString as string ?? j.JournalDate as string),
    journal_number: j.JournalNumber ?? null,
    reference: j.Reference ?? null,
    source_type: j.SourceType ?? null,
    source_id: j.SourceID ?? null,
    created_date_utc: j.CreatedDateUTC ? parseXeroTimestamp(j.CreatedDateUTC as string) : null,
    synced_at: new Date().toISOString(),
  };
}

function mapJournalLines(j: Record<string,unknown>, journalId: string) {
  return ((j.JournalLines as unknown[]) ?? []).map((jl: unknown) => {
    const l = jl as Record<string,unknown>;
    return {
      id: `${journalId}:${l.JournalLineID}`,
      journal_id: journalId,
      journal_line_id: l.JournalLineID ?? null,
      account_id: l.AccountID ?? null,
      account_code: l.AccountCode ?? null,
      account_name: l.AccountName ?? null,
      account_type: l.AccountType ?? null,
      net_amount: l.NetAmount ?? null,
      gross_amount: l.GrossAmount ?? null,
      tax_amount: l.TaxAmount ?? null,
      description: l.Description ?? null,
      tax_type: l.TaxType ?? null,
      is_blank_line: l.IsBlankLine ?? null,
    };
  });
}

// ── Bank Transactions ─────────────────────────────────────────────────────────
function mapBankTransaction(bt: Record<string,unknown>, tenantId: string, companyName: string) {
  const contact = (bt.Contact as Record<string,unknown>) ?? {};
  const bankAccount = (bt.BankAccount as Record<string,unknown>) ?? {};
  return {
    id: bt.BankTransactionID,
    xero_tenant_id: tenantId,
    company_name: companyName,
    transaction_type: bt.Type ?? null,
    contact_name: contact.Name ?? null,
    bank_account_id: bankAccount.AccountID ?? null,
    bank_account_name: bankAccount.Name ?? null,
    bank_account_code: bankAccount.Code ?? null,
    status: bt.Status ?? null,
    reference: bt.Reference ?? null,
    total: bt.Total ?? null,
    sub_total: bt.SubTotal ?? null,
    total_tax: bt.TotalTax ?? null,
    date: parseXeroDate(bt.DateString as string ?? bt.Date as string),
    currency_code: bt.CurrencyCode ?? null,
    is_reconciled: bt.IsReconciled ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ── Credit Notes ──────────────────────────────────────────────────────────────
function mapCreditNote(cn: Record<string,unknown>, tenantId: string, companyName: string) {
  const contact = (cn.Contact as Record<string,unknown>) ?? {};
  return {
    id: cn.CreditNoteID,
    xero_tenant_id: tenantId,
    company_name: companyName,
    credit_note_type: cn.Type ?? null,
    credit_note_number: cn.CreditNoteNumber ?? null,
    contact_name: contact.Name ?? null,
    status: cn.Status ?? null,
    date: parseXeroDate(cn.DateString as string ?? cn.Date as string),
    total: cn.Total ?? null,
    applied_amount: cn.AppliedAmount ?? null,
    remaining_credit: cn.RemainingCredit ?? null,
    currency_code: cn.CurrencyCode ?? null,
    reference: cn.Reference ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ── Chart of Accounts ─────────────────────────────────────────────────────────
function mapAccount(a: Record<string,unknown>, tenantId: string, companyName: string) {
  return {
    account_id: a.AccountID,
    xero_tenant_id: tenantId,
    company_name: companyName,
    code: a.Code ?? null,
    name: a.Name ?? null,
    status: a.Status ?? null,
    type: a.Type ?? null,
    tax_type: a.TaxType ?? null,
    description: a.Description ?? null,
    class: a.Class ?? null,
    enable_payments_to_account: a.EnablePaymentsToAccount ?? null,
    show_in_expense_claims: a.ShowInExpenseClaims ?? null,
    bank_account_number: a.BankAccountNumber ?? null,
    currency_code: a.CurrencyCode ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ── Contacts ──────────────────────────────────────────────────────────────────
function mapContact(c: Record<string,unknown>, tenantId: string, companyName: string) {
  const addresses = (c.Addresses as unknown[]) ?? [];
  const postalAddr = (addresses.find((a: unknown) => (a as Record<string,unknown>).AddressType === 'POBOX') ?? addresses[0] ?? {}) as Record<string,unknown>;
  const phones = (c.Phones as unknown[]) ?? [];
  const defaultPhone = (phones.find((p: unknown) => (p as Record<string,unknown>).PhoneType === 'DEFAULT') ?? phones[0] ?? {}) as Record<string,unknown>;
  const phoneNumber = [defaultPhone.PhoneCountryCode, defaultPhone.PhoneAreaCode, defaultPhone.PhoneNumber].filter(Boolean).join(' ') || null;
  return {
    id: c.ContactID,
    xero_tenant_id: tenantId,
    company_name: companyName,
    name: c.Name ?? null,
    email: c.EmailAddress ?? null,
    phone: phoneNumber,
    is_supplier: c.IsSupplier ?? false,
    is_customer: c.IsCustomer ?? false,
    contact_status: c.ContactStatus ?? null,
    address_line1: postalAddr.AddressLine1 ?? null,
    address_line2: postalAddr.AddressLine2 ?? null,
    city: postalAddr.City ?? null,
    region: postalAddr.Region ?? null,
    postal_code: postalAddr.PostalCode ?? null,
    country: postalAddr.Country ?? null,
    tax_number: c.TaxNumber ?? null,
    currency_code: c.DefaultCurrency ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ── Purchase Orders ───────────────────────────────────────────────────────────
function mapPurchaseOrder(po: Record<string,unknown>, tenantId: string, companyName: string) {
  const contact = (po.Contact as Record<string,unknown>) ?? {};
  return {
    id: po.PurchaseOrderID,
    xero_tenant_id: tenantId,
    company_name: companyName,
    purchase_order_number: po.PurchaseOrderNumber ?? null,
    contact_id: contact.ContactID ?? null,
    contact_name: contact.Name ?? null,
    status: po.Status ?? null,
    date: parseXeroDate(po.DateString as string ?? po.Date as string),
    delivery_date: parseXeroDate(po.DeliveryDateString as string ?? po.DeliveryDate as string),
    total: po.Total ?? null,
    sub_total: po.SubTotal ?? null,
    total_tax: po.TotalTax ?? null,
    currency_code: po.CurrencyCode ?? null,
    reference: po.Reference ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ── Tracking Categories ──────────────────────────────────────────────────────
function mapTrackingCategories(categories: Record<string,unknown>[], tenantId: string, companyName: string) {
  const rows: Record<string,unknown>[] = [];
  for (const cat of categories) {
    for (const opt of (cat.Options as Record<string,unknown>[]) ?? []) {
      rows.push({
        tracking_category_id: cat.TrackingCategoryID,
        xero_tenant_id: tenantId,
        company_name: companyName,
        name: cat.Name ?? null,
        status: cat.Status ?? null,
        option_id: opt.TrackingOptionID,
        option_name: opt.Name ?? null,
        option_status: opt.Status ?? null,
        synced_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });

  const body = await req.json();
  const { tenantId, tenantName: companyName } = body;
  const synced: Record<string, number> = {};

  try {
    if (body.bills?.length) {
      const bills = body.bills as Record<string,unknown>[];
      synced.bills = await upsert('xero_bills', bills.map(b => mapBill(b, tenantId, companyName)));
      synced.billLineItems = await upsert('xero_bill_line_items', bills.flatMap(b => mapBillLineItems(b, b.InvoiceID as string)));
      const apPayments = bills.flatMap(b => mapInvoicePayments(b, b.InvoiceID as string, 'AP', tenantId, companyName));
      if (apPayments.length) synced.apPayments = await upsert('xero_invoice_payments', apPayments);
    }
    if (body.ar_invoices?.length) {
      const invoices = body.ar_invoices as Record<string,unknown>[];
      synced.arInvoices = await upsert('xero_ar_invoices', invoices.map(i => mapArInvoice(i, tenantId, companyName)));
      synced.arLineItems = await upsert('xero_ar_line_items', invoices.flatMap(i => mapArLineItems(i, i.InvoiceID as string)));
      const arPayments = invoices.flatMap(i => mapInvoicePayments(i, i.InvoiceID as string, 'AR', tenantId, companyName));
      if (arPayments.length) synced.arPayments = await upsert('xero_invoice_payments', arPayments);
    }
    if (body.journals?.length) {
      const journals = body.journals as Record<string,unknown>[];
      synced.journals = await upsert('xero_journals', journals.map(j => mapJournal(j, tenantId, companyName)));
      synced.journalLines = await upsert('xero_journal_lines', journals.flatMap(j => mapJournalLines(j, j.JournalID as string)));
    }
    if (body.bank_transactions?.length) {
      synced.bankTransactions = await upsert('xero_bank_transactions', (body.bank_transactions as Record<string,unknown>[]).map(bt => mapBankTransaction(bt, tenantId, companyName)));
    }
    if (body.credit_notes?.length) {
      synced.creditNotes = await upsert('xero_credit_notes', (body.credit_notes as Record<string,unknown>[]).map(cn => mapCreditNote(cn, tenantId, companyName)));
    }
    if (body.accounts?.length) {
      synced.accounts = await upsert('xero_accounts', (body.accounts as Record<string,unknown>[]).map(a => mapAccount(a, tenantId, companyName)));
    }
    if (body.contacts?.length) {
      synced.contacts = await upsert('xero_contacts', (body.contacts as Record<string,unknown>[]).map(c => mapContact(c, tenantId, companyName)));
    }
    // ── NEW: Purchase Orders ──
    if (body.purchase_orders?.length) {
      synced.purchaseOrders = await upsert('xero_purchase_orders', (body.purchase_orders as Record<string,unknown>[]).map(po => mapPurchaseOrder(po, tenantId, companyName)));
    }
    // ── NEW: Tracking Categories ──
    if (body.tracking_categories?.length) {
      const rows = mapTrackingCategories(body.tracking_categories as Record<string,unknown>[], tenantId, companyName);
      if (rows.length) synced.trackingCategories = await upsert('xero_tracking_categories', rows);
    }

    return Response.json({ success: true, synced });
  } catch (e) {
    console.error('sync-xero error:', e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
