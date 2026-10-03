import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ALL_TEMPLATES, REGIONS, getTemplate, suggestDueDate, templatesForRegion, type Region } from '../../shared/packs';
import { useI18n } from '../i18n';
import { ApiError, useApi } from '../lib/api';
import type { Firm, Lang } from '../lib/types';

export default function NewRequest() {
  const { t, lang } = useI18n();
  const api = useApi();
  const nav = useNavigate();

  const [firm, setFirm] = useState<Firm | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [clientName, setClientName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [due, setDue] = useState('');
  const [dueTouched, setDueTouched] = useState(false);
  const [clientLang, setClientLang] = useState<Lang>('en');
  const [sendNow, setSendNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ firm: Firm }>('/me')
      .then(({ firm }) => {
        setFirm(firm);
        setClientLang(firm.language);
        setTemplateId(templatesForRegion(firm.region)[0].id);
      })
      .catch(() => setError(t('error_generic')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const templates = useMemo(() => (!firm || showAll ? ALL_TEMPLATES : templatesForRegion(firm.region)), [firm, showAll]);
  const template = getTemplate(templateId);
  const label = (tpl: { en: string; ar: string }) => (lang === 'ar' ? tpl.ar : tpl.en);

  // Pre-fill the due date from the template's deadline rule until the preparer edits it.
  useEffect(() => {
    if (!dueTouched && template) setDue(suggestDueDate(template.deadline) ?? '');
  }, [template, dueTouched]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ id: string; emailStatus: string }>('/requests', {
        clientName,
        clientEmail: email || undefined,
        clientPhone: phone || undefined,
        templateId,
        dueDate: due || undefined,
        language: clientLang,
        sendNow: sendNow && Boolean(email),
      });
      nav(`/request/${res.id}`, { state: { notice: res.emailStatus } });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'plan_limit' ? t('error_plan') : t('error_generic'));
      setBusy(false);
    }
  }

  if (!firm) return <p className="hint">…</p>;

  return (
    <>
      <div className="page-head">
        <h1>{t('nav_new')}</h1>
      </div>
      <form onSubmit={onSubmit} className="form">
        <div className="field">
          <label htmlFor="tpl">{t('form_template')}</label>
          <select id="tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {showAll
              ? (Object.keys(REGIONS) as Region[]).map((r) => (
                  <optgroup key={r} label={REGIONS[r][lang]}>
                    {templatesForRegion(r).map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {label(tpl)}
                      </option>
                    ))}
                  </optgroup>
                ))
              : templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {label(tpl)}
                  </option>
                ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            {t('form_show_all')}
          </label>
        </div>

        <div className="field">
          <label htmlFor="name">{t('form_client_name')}</label>
          <input id="name" required maxLength={120} value={clientName} onChange={(e) => setClientName(e.target.value)} autoComplete="off" />
        </div>

        <div className="field">
          <label htmlFor="email">{t('form_client_email')}</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" dir="ltr" />
        </div>

        <div className="field">
          <label htmlFor="phone">{t('form_client_phone')}</label>
          <input id="phone" type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="971501234567" autoComplete="off" dir="ltr" />
          <p className="hint">{t('form_phone_hint')}</p>
        </div>

        <div className="field">
          <label htmlFor="due">{t('form_due')}</label>
          <input
            id="due"
            type="date"
            value={due}
            onChange={(e) => {
              setDue(e.target.value);
              setDueTouched(true);
            }}
            dir="ltr"
          />
          <p className="hint">
            {t('form_due_hint')} {template?.deadline.note}
          </p>
        </div>

        <div className="field">
          <label htmlFor="clang">{t('form_language')}</label>
          <select id="clang" value={clientLang} onChange={(e) => setClientLang(e.target.value === 'ar' ? 'ar' : 'en')}>
            <option value="en">{t('lang_en')}</option>
            <option value="ar">{t('lang_ar')}</option>
          </select>
        </div>

        <label className="check">
          <input type="checkbox" checked={sendNow && Boolean(email)} disabled={!email} onChange={(e) => setSendNow(e.target.checked)} />
          {t('form_send_now')}
        </label>

        {error && <p className="hint bad" role="alert">{error}</p>}
        <button className="btn primary wide" type="submit" disabled={busy || !templateId}>
          {busy ? t('form_creating') : t('form_create')}
        </button>
      </form>
    </>
  );
}
