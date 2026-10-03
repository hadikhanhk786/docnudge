import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDate } from '../../shared/messages';
import { REGIONS, type Region } from '../../shared/packs';
import { useI18n, type Key } from '../i18n';
import { useApi } from '../lib/api';
import type { Firm, Lang } from '../lib/types';

interface Form {
  name: string;
  region: Region;
  language: Lang;
  notifyEmail: string;
  replyTo: string;
}

interface Billing {
  plan: Firm['plan'];
  renews: string | null;
  hasCustomer: boolean;
  used: number;
  limit: number;
}

const PLAN_KEY: Record<Firm['plan'], Key> = { trial: 'plan_trial', active: 'plan_active', past_due: 'plan_past_due', canceled: 'plan_canceled' };
const PLAN_CLASS: Record<Firm['plan'], string> = { trial: 'off', active: 'ok', past_due: 'wait', canceled: 'bad' };

export default function Settings() {
  const { t, lang } = useI18n();
  const api = useApi();
  const [params] = useSearchParams();
  const [form, setForm] = useState<Form | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [billing, setBilling] = useState<Billing | null>(null);
  const [billingState, setBillingState] = useState<'idle' | 'busy' | 'error'>('idle');

  useEffect(() => {
    api.get<{ firm: Firm; requestsUsed: number; trialLimit: number }>('/me').then(({ firm, requestsUsed, trialLimit }) => {
      setForm({ name: firm.name, region: firm.region, language: firm.language, notifyEmail: firm.notify_email ?? '', replyTo: firm.reply_to ?? '' });
      setBilling({ plan: firm.plan, renews: firm.current_period_end, hasCustomer: Boolean(firm.billing_customer_id), used: requestsUsed, limit: trialLimit });
    });
  }, [api]);

  /** Checkout and the customer portal are hosted by Dodo Payments; the server returns the URL to open. */
  async function openBilling(path: string, body?: unknown) {
    setBillingState('busy');
    try {
      const { url } = await api.post<{ url: string }>(path, body);
      window.location.assign(url);
    } catch {
      setBillingState('error');
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setState('saving');
    try {
      await api.put('/firm', form);
      setState('saved');
    } catch {
      setState('error');
    }
  }

  if (!form) return <p className="hint">…</p>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm({ ...form, [k]: v });
    setState('idle');
  };

  return (
    <>
      <div className="page-head">
        <h1>{t('settings_title')}</h1>
      </div>
      <form onSubmit={onSubmit} className="form">
        <div className="field">
          <label htmlFor="fname">{t('settings_name')}</label>
          <input id="fname" required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="region">{t('settings_region')}</label>
          <select id="region" value={form.region} onChange={(e) => set('region', e.target.value as Region)}>
            {(Object.keys(REGIONS) as Region[]).map((r) => (
              <option key={r} value={r}>
                {t(`region_${r}` as Key)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="flang">{t('settings_language')}</label>
          <select id="flang" value={form.language} onChange={(e) => set('language', e.target.value === 'ar' ? 'ar' : 'en')}>
            <option value="en">{t('lang_en')}</option>
            <option value="ar">{t('lang_ar')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="notify">{t('settings_notify')}</label>
          <input id="notify" type="email" value={form.notifyEmail} onChange={(e) => set('notifyEmail', e.target.value)} dir="ltr" />
          <p className="hint">{t('settings_notify_hint')}</p>
        </div>
        <div className="field">
          <label htmlFor="reply">{t('settings_reply_to')}</label>
          <input id="reply" type="email" value={form.replyTo} onChange={(e) => set('replyTo', e.target.value)} dir="ltr" />
          <p className="hint">{t('settings_reply_hint')}</p>
        </div>
        {state === 'error' && <p className="hint bad" role="alert">{t('error_generic')}</p>}
        {state === 'saved' && <p className="hint ok" role="status">{t('settings_saved')}</p>}
        <button className="btn primary wide" type="submit" disabled={state === 'saving'}>
          {state === 'saving' ? t('settings_saving') : t('settings_save')}
        </button>
      </form>

      {billing && (
        <section className="form" aria-labelledby="billing-title">
          <h2 id="billing-title" className="section-title">{t('billing_title')}</h2>
          {billing.plan === 'past_due' && <p className="hint warn" role="status">{t('billing_past_due')}</p>}
          {billing.plan === 'canceled' && <p className="hint bad" role="status">{t('billing_canceled')}</p>}
          {params.get('billing') === 'done' && <p className="hint ok" role="status">{t('billing_done')}</p>}
          <p className="row-meta">
            <span className={`chip ${PLAN_CLASS[billing.plan]}`}>{t(PLAN_KEY[billing.plan])}</span>
          </p>
          {billing.plan === 'trial' && billing.limit > 0 && <p className="hint">{t('billing_usage', { used: billing.used, limit: billing.limit })}</p>}
          {billing.renews && billing.plan !== 'canceled' && <p className="hint">{t('billing_renews', { date: formatDate(billing.renews, lang) })}</p>}
          <div className="actions">
            {(billing.plan === 'trial' || billing.plan === 'canceled') && (
              <>
                <button type="button" className="btn primary" disabled={billingState === 'busy'} onClick={() => openBilling('/billing/checkout', { interval: 'monthly' })}>
                  {t('billing_upgrade_monthly')}
                </button>
                <button type="button" className="btn ghost" disabled={billingState === 'busy'} onClick={() => openBilling('/billing/checkout', { interval: 'yearly' })}>
                  {t('billing_upgrade_yearly')}
                </button>
              </>
            )}
            {billing.hasCustomer && (
              <button type="button" className="btn ghost" disabled={billingState === 'busy'} onClick={() => openBilling('/billing/portal')}>
                {t('billing_manage')}
              </button>
            )}
          </div>
          {billingState === 'error' && <p className="hint bad" role="alert">{t('billing_unavailable')}</p>}
        </section>
      )}
    </>
  );
}
