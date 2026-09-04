// js/tabela.js
(function () {
  'use strict';

  // URL do seu Web App (Apps Script publicado como Anyone)
  const WEBAPP_URL =
    'https://script.google.com/macros/s/AKfycbwD1zCtYAD_UMaFv9rF63QWJ-RYqZbTv5RbRSVCoUqpZB8WFnOqJAhdqCmd_kxhneewoA/exec';

  const $ = (s) => document.querySelector(s);
  const tbody = $('#tvBody');
  const stamp = $('#stamp');
  const statusFilter = $('#statusFilter');
  const headerParcelasMensais = $('#headerParcelasMensais');
  const headerIntercaladas = $('#headerIntercaladas');
  const paymentPlan = window.CityParkPaymentPlan;

  let allRows = [];

  const esc = (x) =>
    String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const brMoney = (v) => {
    if (v == null || v === '') return '';
    if (String(v).trim() === '-') return '-';
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : String(v);
  };

  const normalizeStatus = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const clsStatus = (s) => {
    const k = normalizeStatus(s);
    if (k.includes('vend')) return 'vendido';
    if (k.includes('reserv')) return 'reservado';
    return 'disponivel';
  };

  function normalizeResponse(data) {
    if (Array.isArray(data)) {
      if (data.length && typeof data[0] === 'object' && !Array.isArray(data[0])) return data;
      if (data.length && Array.isArray(data[0])) {
        const headers = data[0].map(String);
        return data.slice(1).map((row) => {
          const obj = {};
          headers.forEach((h, i) => (obj[h] = row[i]));
          return obj;
        });
      }
      return [];
    }
    const candidates = ['rows', 'data', 'values', 'resultado', 'result'];
    for (const key of candidates) {
      if (data && Array.isArray(data[key])) {
        const arr = data[key];
        if (arr.length && Array.isArray(arr[0])) {
          const headers = arr[0].map(String);
          return arr.slice(1).map((row) => {
            const obj = {};
            headers.forEach((h, i) => (obj[h] = row[i]));
            return obj;
          });
        }
        return arr;
      }
    }
    return [];
  }

  const pick = (obj, keys) => {
    for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k];
    return '';
  };

  function statusLabel() {
    return statusFilter?.selectedOptions?.[0]?.textContent || 'Todos os status';
  }

  function getStatus(row) {
    return pick(row, ['STATUS', 'Status', 'status']);
  }

  function applyFilter() {
    const selected = normalizeStatus(statusFilter?.value || '');
    const rows = selected
      ? allRows.filter((row) => clsStatus(getStatus(row)) === selected)
      : allRows;

    render(rows);
  }

  function render(rows) {
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();

    rows.forEach((r) => {
      const unidade   = pick(r, ['UNIDADE', 'Unidade', 'unidade']);
      const tipologia = pick(r, ['TIPOLOGIA', 'Tipologia', 'tipologia']);
      const area      = pick(r, ['ÁREA', 'AREA', 'Área', 'area']);
      const preco     = pick(r, ['PREÇO À VISTA', 'PRECO À VISTA', 'Preço', 'Preco', 'preco']);
      const sinal     = pick(r, ['SINAL', 'Sinal', 'sinal']);
      const parcelaMensal = pick(r, [
        'PARCELA MENSAL',
        '40 PARC. MENSAIS',
        '40 PARC MENSAIS',
        '40 PARC',
        '40 parcelas',
        '40 PARCELAS'
      ]);
      const intercalada = pick(r, [
        'INTERCALADA',
        '6 INTERCAL. SEMESTRAIS',
        '6 INTERCAL SEMESTRAIS',
        '6 INTERCALADAS'
      ]);
      const chaves    = pick(r, ['CHAVES', 'Chaves', 'chaves']);
      const status    = pick(r, ['STATUS', 'Status', 'status']);

      const condition = paymentPlan.format({
        price: preco,
        downPayment: sinal,
        monthlyInstallment: parcelaMensal,
        semiannualInstallment: intercalada,
        keys: chaves
      });

      // Constantes que servirão para decidir se os valores devem ser ocultados ou não (mesmo código de vendas.js)
      const statusNormalizado = normalizeStatus(status);
      const ocultarValores = statusNormalizado.includes("reservad") || statusNormalizado.includes("vendid");
      const mostrarValor = (valor) => {
        return ocultarValores ? "-" : valor;
      };

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(unidade)}</td>
        <td>${esc(tipologia)}</td>
        <td>${esc(area)}</td>
        <td>${esc(mostrarValor(condition.price))}</td>
        <td>${esc(mostrarValor(condition.downPayment))}</td>
        <td>${esc(mostrarValor(condition.monthlyInstallment))}</td>
        <td>${esc(mostrarValor(condition.semiannualInstallment))}</td>
        <td>${esc(mostrarValor(condition.keys))}</td>
        <td class="status ${clsStatus(status)}">${esc(status)}</td>
      `;
      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
    stamp.textContent = `Atualizado agora: ${new Date().toLocaleString('pt-BR')}`;
  }

  async function loadConditions() {
    try {
      const url = `${WEBAPP_URL}?resource=conditions`;

      const res = await fetch(url, {
        cache: 'no-store',
        credentials: 'omit'
      });

      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }

      const data = await res.json();

      const parcelasMensais = Number(data.parcelasMensais);
      const intercaladas = Number(data.intercaladas);

      if (Number.isFinite(parcelasMensais) && headerParcelasMensais) {
        headerParcelasMensais.textContent =
          `${parcelasMensais} parc. mensais`;
      }

      if (Number.isFinite(intercaladas) && headerIntercaladas) {
        headerIntercaladas.textContent =
          `${intercaladas} intercal. semestrais`;
      }

    } catch (e) {
      // A tabela continua funcionando com o texto fallback do HTML.
      console.warn('[tabela] não foi possível carregar as condições:', e);
    }
  }
  async function load() {
    try {
      stamp.textContent = 'Carregando dados…';
      const res = await fetch(WEBAPP_URL, { cache: 'no-store', credentials: 'omit' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      let data;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        const txt = await res.text();
        try { data = JSON.parse(txt); } catch { data = []; }
      }

      allRows = normalizeResponse(data);
      applyFilter();
    } catch (e) {
      console.error('[tabela] erro:', e);
      stamp.textContent = 'Falha ao carregar a tabela. Tente recarregar a página.';
    }
  }

  statusFilter?.addEventListener('change', applyFilter);
  $('#btnPrint')?.addEventListener('click', () => window.print());

  loadConditions();
  load();
})();