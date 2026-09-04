(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.CityParkPaymentPlan = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MONTHLY_INSTALLMENTS = 40;
  const SEMIANNUAL_INSTALLMENTS = 6;
  const MAX_PAYMENT_GROUPS = 12;

  function currencyToCents(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.round(value * 100) : null;
    }

    const text = String(value ?? "").trim();
    if (!text || text === "-") return null;

    const withoutCurrency = text.replace(/R\$|\s/g, "");
    const normalized = withoutCurrency.includes(",")
      ? withoutCurrency.replace(/\./g, "").replace(",", ".")
      : withoutCurrency;
    const amount = Number(normalized.replace(/[^\d.-]/g, ""));

    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
  }

  function formatMoney(cents) {
    return (cents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }

  function formatOriginal(value) {
    const cents = currencyToCents(value);
    return Number.isInteger(cents) ? formatMoney(cents) : String(value ?? "");
  }

  function calculate(values) {
    const priceCents = currencyToCents(values.price);
    const downPaymentCents = currencyToCents(values.downPayment);
    const monthlyInstallmentCents = currencyToCents(values.monthlyInstallment);
    const semiannualInstallmentCents = currencyToCents(values.semiannualInstallment);

    if (![priceCents, downPaymentCents, monthlyInstallmentCents, semiannualInstallmentCents].every(Number.isInteger)) {
      return null;
    }

    const keysCents =
      priceCents -
      downPaymentCents -
      MONTHLY_INSTALLMENTS * monthlyInstallmentCents -
      SEMIANNUAL_INSTALLMENTS * semiannualInstallmentCents;

    if (keysCents < 0) return null;

    return {
      priceCents,
      downPaymentCents,
      monthlyInstallmentCents,
      semiannualInstallmentCents,
      keysCents,
      totalCents:
        downPaymentCents +
        MONTHLY_INSTALLMENTS * monthlyInstallmentCents +
        SEMIANNUAL_INSTALLMENTS * semiannualInstallmentCents +
        keysCents
    };
  }

  function format(values) {
    // A Tabela de Vendas no Google Sheets passa a ser a fonte oficial dos
    // valores da condição comercial. O site apenas formata e exibe os dados.
    //
    // Mantemos calculate() e as constantes 40/6 exportadas temporariamente
    // por compatibilidade com qualquer código legado, mas format() NÃO usa
    // mais esses valores para recalcular Chaves/Financiamento.
    return {
      price: formatOriginal(values.price),
      downPayment: formatOriginal(values.downPayment),
      monthlyInstallment: formatOriginal(values.monthlyInstallment),
      semiannualInstallment: formatOriginal(values.semiannualInstallment),
      keys: formatOriginal(values.keys),
      balanced: null
    };
  }

  // Utilitários dos formulários; não alteram os valores exibidos por format().
  function paymentIntervalMonths(periodicity) {
    return {
      mensal: 1,
      semestral: 6,
      anual: 12,
      outra: 0,
      unica: 0
    }[periodicity] ?? null;
  }

  function parseDateOnly(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day, 12, 0, 0, 0);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
  }

  function addMonthsClamped(date, months) {
    const target = new Date(date.getTime());
    const day = target.getDate();
    target.setDate(1);
    target.setMonth(target.getMonth() + months);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    return target;
  }

  function buildSchedule(firstDate, quantity, periodicity) {
    const start = parseDateOnly(firstDate);
    const count = Number(quantity);
    const interval = paymentIntervalMonths(periodicity);
    if (!start || !Number.isInteger(count) || count < 1 || interval === null) return [];
    return Array.from({ length: count }, (_, index) => addMonthsClamped(start, interval * index));
  }

  function sumPaymentGroups(groups) {
    return groups.reduce((sum, group) => {
      const quantity = Number(group.quantidade);
      const unitValue = Number(group.valorUnitarioCentavos);
      return sum + (Number.isInteger(quantity) && Number.isInteger(unitValue) ? quantity * unitValue : 0);
    }, 0);
  }

  function percentageOfTable(totalCents, tableValueCents) {
    const total = Number(totalCents);
    const table = Number(tableValueCents);
    if (!Number.isFinite(total) || !Number.isFinite(table) || table <= 0) return 0;
    return Math.round((total / table) * 10000) / 100;
  }

  return {
    MONTHLY_INSTALLMENTS,
    SEMIANNUAL_INSTALLMENTS,
    MAX_PAYMENT_GROUPS,
    currencyToCents,
    calculate,
    format,
    buildSchedule,
    sumPaymentGroups,
    percentageOfTable
  };
});
