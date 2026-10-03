import { useEffect, useState, type FormEvent } from 'react';
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

export default function Settings() {
  const { t } = useI18n();
  const api = useApi();
  const [form, setForm] = useState<Form | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    api.get<{ firm: Firm }>('/me').then(({ firm }) =>
      setForm({ name: firm.name, region: firm.region, language: firm.language, notifyEmail: firm.notify_email ?? '', replyTo: firm.reply_to ?? '' }),
    );
  }, [api]);

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
    </>
  );
}
