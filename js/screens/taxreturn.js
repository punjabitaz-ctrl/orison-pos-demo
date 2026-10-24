'use strict';

import { $t, $tn, N_, dateLocale } from '../lang.js';

/* The tax return: for a period, what the shop collected on its sales, what it
   paid its suppliers, and the difference — which is the number a return asks
   for. Everything here was already being recorded; this is the page that adds
   it up, with the transactions behind every figure so somebody can check the
   number before they file it.

   Quarters are first-class, because that is how a return is usually filed. */

import { api } from '../api.js';
import { idb } from '../db.js';
import { screenHead, sectionHead, dataTable } from '../components.js';
import { fmt, esc, toast } from '../ui.js';
import { exportCsv } from '../csv.js';
import { exportPdf } from '../pdf-export.js';

/* The periods a return is actually filed for. Dates are plain YYYY-MM-DD. */
export function taxPeriods(today = new Date()) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const y = today.getUTCFullYear();
  const q = Math.floor(today.getUTCMonth() / 3);
  const qStart = (yy, qq) => new Date(Date.UTC(yy, qq * 3, 1));
  const qEnd = (yy, qq) => new Date(Date.UTC(yy, qq * 3 + 3, 0));
  const prevQ = q === 0 ? { y: y - 1, q: 3 } : { y, q: q - 1 };
  return [
    { id: 'lastQuarter', label: N_('Last quarter'), from: iso(qStart(prevQ.y, prevQ.q)), to: iso(qEnd(prevQ.y, prevQ.q)) },
    { id: 'thisQuarter', label: N_('This quarter'), from: iso(qStart(y, q)), to: iso(today) },
    { id: 'thisYear', label: N_('This year'), from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(today) },
    { id: 'custom', label: N_('Custom'), from: '', to: '' },
  ];
}

export function taxReturnCsv(data) {
  const n = (v) => (v == null ? '' : String(v));
  const s = data.summary;
  return {
    title: `Tax return ${data.period.from} to ${data.period.to}`,
    extra: [
      {
        title: 'Summary',
        columns: ['line', 'amount'],
        rows: [
          ['Tax collected on sales', n(s.taxCollected)],
          ['Tax refunded to customers', n(s.taxRefunded)],
          ['Output tax', n(s.outputTax)],
          ['Input tax paid to suppliers', n(s.inputTax)],
          [s.reclaimable ? 'Reclaimable' : 'Net due', n(Math.abs(s.netDue))],
          ['Net sales', n(s.netSales)],
          ['Net purchases', n(s.netPurchases)],
        ],
      },
      {
        title: 'By month',
        columns: ['month', 'collected', 'refunded', 'input_tax', 'net'],
        rows: (data.byMonth || []).map((m) => [m.month, n(m.collected), n(m.refunded), n(m.paid), n(m.net)]),
      },
    ],
    columns: ['date', 'kind', 'reference', 'counterparty', 'net', 'tax', 'total'],
    rows: (data.lines || []).map((l) => [l.at, l.kind, l.ref, l.counterparty, n(l.net), n(l.tax), n(l.total)]),
  };
}

export const screen = {
  id: 'taxreturn',
  tab: 'taxreturn',
  title: 'Tax return',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const user = ctx.state.user || (await idb.get('meta', 'config'))?.user || {};
    const role = user.role || 'cashier';
    if (role !== 'admin' && role !== 'manager') {
      root.innerHTML = `<div class="empty"><p>${$t('Managers and admins only.')}</p></div>`;
      return;
    }

    const periods = taxPeriods(new Date());
    let preset = 'lastQuarter';
    let from = periods[0].from;
    let to = periods[0].to;
    let data = null;
    let loadErr = '';

    /* the key is a UTC month; rendering it in local time turns 2026-09 into
       August everywhere west of Greenwich */
    const month = (key) => {
      const d = new Date(`${key}-01T00:00:00Z`);
      return isNaN(d) ? key : d.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
    };
    const when = (iso) => {
      const d = iso ? new Date(iso) : null;
      return d && !isNaN(d) ? d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : '—';
    };
    const kindLabel = (k) => (k === 'sale' ? $t('Sale') : k === 'refund' ? $t('Refund') : $t('Stock bought'));

    async function load() {
      loadErr = '';
      root.innerHTML = `<div class="empty"><p>${$t('Loading…')}</p></div>`;
      try {
        data = await api.get(`/api/reports/tax?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      } catch (err) {
        data = null;
        loadErr = (err && err.offline) ? $t('Offline — the tax return needs the server') : ((err && err.message) || $t('Failed to load the tax return'));
      }
      draw();
    }

    function draw() {
      const s = data && data.summary;
      root.innerHTML = `
        ${screenHead({
          title: $t('Tax return'),
          sub: $t('What was collected, what was paid, and the difference'),
          actions: data ? `<div class="scr-actions">
            <button class="btn btn-sm btn-ghost" id="txCsv">${$t('Export CSV')}</button>
            <button class="btn btn-sm btn-ghost" id="txPdf">${$t('PDF')}</button>
          </div>` : '',
        })}

        <div class="rep-chips">
          ${periods.map((p) => `<button class="rep-chip ${p.id === preset ? 'on' : ''}" data-p="${esc(p.id)}">${esc($t(p.label))}</button>`).join('')}
          ${preset === 'custom' ? `
            <div class="rep-dates">
              <input class="field" id="txFrom" type="date" value="${esc(from)}" aria-label="${$t('From')}">
              <input class="field" id="txTo" type="date" value="${esc(to)}" aria-label="${$t('To')}">
              <button class="btn btn-sm" id="txGo">${$t('Go')}</button>
            </div>` : ''}
        </div>

        ${loadErr ? `<div class="empty"><p>${esc(loadErr)}</p></div>` : !data ? '' : `
        <p class="muted scr-note">${esc($t('{shop}{reg} · {from} to {to}', {
          shop: data.store.name,
          reg: data.store.taxRegNo ? ` · ${$t('TRN {no}', { no: data.store.taxRegNo })}` : '',
          from: data.period.from, to: data.period.to,
        }))}</p>

        <div class="dash-kpis">
          <div class="dash-kpi"><span>${$t('Tax collected on sales')}</span><strong>${fmt(s.outputTax)}</strong></div>
          <div class="dash-kpi"><span>${$t('Tax paid to suppliers')}</span><strong>${fmt(s.inputTax)}</strong></div>
          <div class="dash-kpi${s.reclaimable ? '' : ' po-overdue-kpi'}">
            <span>${s.reclaimable ? $t('Reclaimable') : $t('Net due')}</span>
            <strong>${fmt(Math.abs(s.netDue))}</strong></div>
        </div>

        <section class="dash-section">
          ${sectionHead({ title: $t('Month by month') })}
          ${(data.byMonth || []).length ? dataTable({
            head: [{ label: $t('Month') }, { label: $t('Collected'), num: true }, { label: $t('Refunded'), num: true },
              { label: $t('Paid to suppliers'), num: true }, { label: $t('Net'), num: true }],
            bodyHtml: data.byMonth.map((m) => `
              <tr>
                <td>${esc(month(m.month))}</td>
                <td class="num">${esc(fmt(m.collected))}</td>
                <td class="num">${esc(fmt(m.refunded))}</td>
                <td class="num">${esc(fmt(m.paid))}</td>
                <td class="num">${esc(fmt(m.net))}</td>
              </tr>`).join(''),
          }) : `<p class="muted">${$t('Nothing with tax on it in this period.')}</p>`}
        </section>

        <section class="dash-section">
          ${sectionHead({ title: $t('Everything behind the figure'),
            asideHtml: `<span class="muted">${esc($tn('{n} transaction', '{n} transactions', data.lineCount))}</span>` })}
          ${(data.lines || []).length ? dataTable({
            head: [{ label: $t('Date') }, { label: $t('What') }, { label: $t('Reference') },
              { label: $t('Net'), num: true }, { label: $t('Tax'), num: true }],
            bodyHtml: data.lines.slice(0, 200).map((l) => `
              <tr>
                <td>${esc(when(l.at))}</td>
                <td>${esc(kindLabel(l.kind))}${l.counterparty ? `<br><span class="muted">${esc(l.counterparty)}</span>` : ''}</td>
                <td><span class="muted">${esc(l.ref)}</span></td>
                <td class="num">${esc(fmt(l.net))}</td>
                <td class="num">${esc(fmt(l.tax))}</td>
              </tr>`).join(''),
          }) : `<p class="muted">${$t('Nothing with tax on it in this period.')}</p>`}
          ${data.lineCount > 200 ? `<p class="muted">${esc($t('Showing the first 200 — the export has all {n}.', { n: data.lineCount }))}</p>` : ''}
        </section>`}
      `;

      root.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
        preset = b.dataset.p;
        const hit = periods.find((p) => p.id === preset);
        if (hit && hit.from) { from = hit.from; to = hit.to; load(); } else { draw(); }
      }));
      root.querySelector('#txGo')?.addEventListener('click', () => {
        from = root.querySelector('#txFrom').value;
        to = root.querySelector('#txTo').value;
        load();
      });
      root.querySelector('#txCsv')?.addEventListener('click', () => {
        exportCsv('tax-return', { ...taxReturnCsv(data), range: data.period });
      });
      root.querySelector('#txPdf')?.addEventListener('click', () => {
        exportPdf('tax-return', {
          title: $t('Tax return'),
          range: data.period,
          subtitle: `${data.store.name}${data.store.taxRegNo ? ` · ${$t('TRN {no}', { no: data.store.taxRegNo })}` : ''}`,
          extra: [{
            title: $t('Summary'),
            columns: [$t('Line'), $t('Amount')],
            numericFrom: 1,
            rows: [
              [$t('Tax collected on sales'), fmt(s.taxCollected)],
              [$t('Tax refunded to customers'), fmt(s.taxRefunded)],
              [$t('Output tax'), fmt(s.outputTax)],
              [$t('Tax paid to suppliers'), fmt(s.inputTax)],
              [s.reclaimable ? $t('Reclaimable') : $t('Net due'), fmt(Math.abs(s.netDue))],
            ],
          }],
          columns: [$t('Month'), $t('Collected'), $t('Refunded'), $t('Paid to suppliers'), $t('Net')],
          numericFrom: 1,
          rows: (data.byMonth || []).map((m) => [month(m.month), fmt(m.collected), fmt(m.refunded), fmt(m.paid), fmt(m.net)]),
          meta: $tn('{n} transaction', '{n} transactions', data.lineCount),
        });
      });
    }

    await load();
  },
};
