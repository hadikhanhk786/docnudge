// Region packs: checklist templates + deadline hints for each market.
// Packs are plain data. To add a region (UK, Canada...), add templates here and a REGIONS entry.
// Deadlines change, so every rule carries a note telling the preparer to verify it.

export type Region = 'us' | 'au' | 'ae';
export type Lang = 'en' | 'ar';

export interface ChecklistItem {
  key: string;
  en: string;
  ar: string;
  required: boolean;
}

export type DeadlineRule =
  | { type: 'annual'; month: number; day: number; note: string }
  | { type: 'quarterly'; months: number[]; day: number; note: string }
  | { type: 'manual'; note: string };

export interface Template {
  id: string;
  region: Region;
  en: string;
  ar: string;
  deadline: DeadlineRule;
  items: ChecklistItem[];
}

export const REGIONS: Record<Region, { en: string; ar: string; defaultLang: Lang }> = {
  us: { en: 'United States', ar: 'الولايات المتحدة', defaultLang: 'en' },
  au: { en: 'Australia', ar: 'أستراليا', defaultLang: 'en' },
  ae: { en: 'United Arab Emirates', ar: 'الإمارات العربية المتحدة', defaultLang: 'en' },
};

const it = (key: string, en: string, ar: string, required = true): ChecklistItem => ({ key, en, ar, required });

export const ALL_TEMPLATES: Template[] = [
  // ---------------------------------------------------------------- United States
  {
    id: 'us.individual',
    region: 'us',
    en: 'Individual tax return (Form 1040)',
    ar: 'الإقرار الضريبي الفردي (نموذج 1040)',
    deadline: {
      type: 'annual', month: 4, day: 15,
      note: 'The US individual deadline is usually April 15 (extensions run to October 15). Check the IRS calendar for the tax year.',
    },
    items: [
      it('photo-id', 'Photo ID (driver license or passport)', 'هوية رسمية بصورة (رخصة القيادة أو جواز السفر)'),
      it('w2', 'W-2 forms from every employer', 'نماذج W-2 من جميع جهات العمل'),
      it('1099', '1099 forms (interest, dividends, freelance, retirement)', 'نماذج 1099 (الفوائد، الأرباح، العمل الحر، التقاعد)'),
      it('last-year', "Last year's tax return", 'الإقرار الضريبي للعام الماضي'),
      it('1098', '1098 forms (mortgage interest, property tax, student loan interest)', 'نماذج 1098 (فوائد الرهن العقاري، ضريبة العقار، فوائد القرض الدراسي)', false),
      it('health', 'Form 1095-A, if you bought health insurance on the marketplace', 'نموذج 1095-A إذا اشتريت التأمين الصحي من السوق الحكومي', false),
      it('deductions', 'Receipts for donations, medical costs, childcare and education', 'إيصالات التبرعات والنفقات الطبية ورعاية الأطفال والتعليم', false),
      it('refund-bank', 'Voided check or bank letter for your refund', 'شيك ملغى أو خطاب من البنك لاسترداد المبلغ', false),
    ],
  },
  {
    id: 'us.self_employed',
    region: 'us',
    en: 'Self-employed or small business return',
    ar: 'إقرار العمل الحر أو المشروع الصغير',
    deadline: {
      type: 'annual', month: 4, day: 15,
      note: 'The US individual deadline is usually April 15 (extensions run to October 15). Check the IRS calendar for the tax year.',
    },
    items: [
      it('income', 'Income records (1099-NEC, 1099-K or your invoices)', 'سجلات الدخل (1099-NEC أو 1099-K أو فواتيرك)'),
      it('bank', 'Business bank and card statements for the year', 'كشوف الحساب البنكي وبطاقات الأعمال للسنة'),
      it('expenses', 'Expense receipts', 'إيصالات المصروفات'),
      it('last-year', "Last year's tax return", 'الإقرار الضريبي للعام الماضي'),
      it('mileage', 'Mileage log, if you drive for work', 'سجل المسافات المقطوعة إذا كنت تقود للعمل', false),
      it('home-office', 'Home office size and costs', 'مساحة المكتب المنزلي وتكاليفه', false),
      it('estimates', 'Proof of estimated tax payments', 'إثبات دفعات الضريبة التقديرية', false),
    ],
  },
  // ---------------------------------------------------------------- Australia
  {
    id: 'au.individual',
    region: 'au',
    en: 'Individual tax return (tax time)',
    ar: 'الإقرار الضريبي الفردي (موسم الضرائب)',
    deadline: {
      type: 'annual', month: 10, day: 31,
      note: 'Self-lodged returns are due 31 October. Clients who join a tax agent before then usually get until 15 May. Check the ATO lodgment program.',
    },
    items: [
      it('income-statement', 'Income statements (check myGov, or send what your employer gave you)', 'بيانات الدخل (راجع myGov أو أرسل ما قدمه صاحب العمل)'),
      it('bank-interest', 'Bank interest summaries', 'ملخصات فوائد الحسابات البنكية'),
      it('investments', 'Dividend and investment statements', 'كشوف الأرباح والاستثمارات', false),
      it('health', 'Private health insurance statement', 'بيان التأمين الصحي الخاص', false),
      it('work-expenses', 'Receipts for work-related expenses', 'إيصالات المصروفات المتعلقة بالعمل', false),
      it('rental', 'Rental property income and expense records', 'سجلات دخل ومصروفات العقار المؤجر', false),
      it('bank-details', 'Screenshot or statement showing your BSB and account number', 'لقطة شاشة أو كشف يظهر رقم BSB ورقم الحساب', false),
      it('photo-id', 'Photo ID', 'هوية رسمية بصورة', false),
    ],
  },
  {
    id: 'au.bas',
    region: 'au',
    en: 'Quarterly BAS prep',
    ar: 'تحضير إقرار BAS الربع سنوي',
    deadline: {
      type: 'quarterly', months: [2, 4, 7, 10], day: 28,
      note: 'Quarterly BAS is usually due 28 Oct, 28 Feb, 28 Apr and 28 Jul. Check your own ATO due dates.',
    },
    items: [
      it('bank', 'Business bank statements for the quarter', 'كشوف الحساب البنكي للأعمال عن الربع'),
      it('sales', 'Sales invoices or an income report', 'فواتير المبيعات أو تقرير الدخل'),
      it('purchases', 'Purchase invoices and receipts', 'فواتير المشتريات والإيصالات'),
      it('payroll', 'Payroll and PAYG withholding summary', 'ملخص الرواتب والضريبة المقتطعة (PAYG)', false),
      it('super', 'Super payment records', 'سجلات مدفوعات التقاعد (Super)', false),
    ],
  },
  {
    id: 'au.bookkeeping',
    region: 'au',
    en: 'Monthly bookkeeping documents',
    ar: 'مستندات مسك الدفاتر الشهرية',
    deadline: { type: 'manual', note: 'Set the date your bookkeeper needs the documents.' },
    items: [
      it('bank', 'Bank and credit card statements', 'كشوف الحسابات البنكية وبطاقات الائتمان'),
      it('sales', 'Sales invoices', 'فواتير المبيعات'),
      it('purchases', 'Supplier bills and receipts', 'فواتير الموردين والإيصالات'),
      it('payroll', 'Payroll reports', 'تقارير الرواتب', false),
      it('loans', 'Loan statements', 'كشوف القروض', false),
    ],
  },
  // ---------------------------------------------------------------- United Arab Emirates
  {
    id: 'ae.vat',
    region: 'ae',
    en: 'VAT return (quarterly)',
    ar: 'إقرار ضريبة القيمة المضافة (ربع سنوي)',
    deadline: {
      type: 'quarterly', months: [1, 4, 7, 10], day: 28,
      note: 'For quarterly filers the return is due 28 days after the period ends (28 Jan, Apr, Jul and Oct for calendar quarters). Confirm your FTA tax periods.',
    },
    items: [
      it('sales', 'Tax invoices you issued (sales)', 'الفواتير الضريبية الصادرة (المبيعات)'),
      it('purchases', 'Tax invoices you received (purchases)', 'الفواتير الضريبية المستلمة (المشتريات)'),
      it('bank', 'Bank statements for the period', 'كشوف الحساب البنكي للفترة'),
      it('notes', 'Credit and debit notes', 'إشعارات الدائن والمدين', false),
      it('customs', 'Import and export customs documents', 'مستندات الاستيراد والتصدير الجمركية', false),
      it('prev-vat', 'Last VAT return and payment receipt', 'إقرار ضريبة القيمة المضافة السابق وإيصال السداد', false),
    ],
  },
  {
    id: 'ae.corporate_tax',
    region: 'ae',
    en: 'Corporate tax return',
    ar: 'إقرار ضريبة الشركات',
    deadline: { type: 'manual', note: 'Due 9 months after your financial year-end. Set the date from the client financial year.' },
    items: [
      it('licence', 'Trade licence', 'الرخصة التجارية'),
      it('fs', 'Financial statements (audited if required)', 'القوائم المالية (مدققة إن لزم)'),
      it('bank', 'Bank statements for the year', 'كشوف الحساب البنكي للسنة'),
      it('vat-returns', 'VAT returns for the period', 'إقرارات ضريبة القيمة المضافة عن الفترة', false),
      it('contracts', 'Key contracts and related-party details', 'العقود الرئيسية وتفاصيل الأطراف ذات العلاقة', false),
      it('prev-ct', 'Last corporate tax return, if any', 'إقرار ضريبة الشركات السابق إن وجد', false),
    ],
  },
  {
    id: 'ae.onboarding',
    region: 'ae',
    en: 'New client onboarding',
    ar: 'تهيئة عميل جديد',
    deadline: { type: 'manual', note: 'Set the date you need the documents.' },
    items: [
      it('licence', 'Trade licence', 'الرخصة التجارية'),
      it('moa', 'Memorandum or articles of association', 'عقد التأسيس أو النظام الأساسي'),
      it('passports', "Owners' passport copies", 'نسخ جوازات سفر المالكين'),
      it('eid', 'Emirates IDs', 'الهويات الإماراتية'),
      it('bank', 'Bank statements (last 3 to 6 months)', 'كشوف الحساب البنكي (آخر 3 إلى 6 أشهر)'),
      it('tax-certs', 'VAT and corporate tax registration certificates (TRN)', 'شهادات التسجيل الضريبي (TRN)', false),
      it('ejari', 'Tenancy contract (Ejari)', 'عقد الإيجار (إيجاري)', false),
      it('prior-fs', 'Prior financial statements', 'القوائم المالية السابقة', false),
    ],
  },
];

export function getTemplate(id: string): Template | undefined {
  return ALL_TEMPLATES.find((t) => t.id === id);
}

export function templatesForRegion(region: Region): Template[] {
  return ALL_TEMPLATES.filter((t) => t.region === region);
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Next occurrence of a template deadline on or after `from` (YYYY-MM-DD), or null for manual rules. */
export function suggestDueDate(rule: DeadlineRule, from: Date = new Date()): string | null {
  const y = from.getUTCFullYear();
  const today = iso(y, from.getUTCMonth() + 1, from.getUTCDate());
  if (rule.type === 'annual') {
    const thisYear = iso(y, rule.month, rule.day);
    return thisYear >= today ? thisYear : iso(y + 1, rule.month, rule.day);
  }
  if (rule.type === 'quarterly') {
    const all = [...rule.months.map((m) => iso(y, m, rule.day)), ...rule.months.map((m) => iso(y + 1, m, rule.day))].sort();
    return all.find((d) => d >= today) ?? null;
  }
  return null;
}
