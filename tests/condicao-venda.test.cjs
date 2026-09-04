const test = require("node:test");
const assert = require("node:assert/strict");
const plan = require("../js/condicao-venda.js");

test("calcula a porcentagem da obra com duas casas decimais", () => {
  assert.equal(plan.percentageOfTable(7000000, 10000000), 70);
  assert.equal(plan.percentageOfTable(7333333, 10000000), 73.33);
  assert.equal(plan.percentageOfTable(10000000, 10000000), 100);
});

test("não calcula porcentagem com valor de tabela inválido", () => {
  assert.equal(plan.percentageOfTable(1000, 0), 0);
  assert.equal(plan.percentageOfTable(1000, null), 0);
});

test("gera vencimentos mensais preservando o último dia possível", () => {
  const dates = plan.buildSchedule("2026-01-31", 3, "mensal");
  assert.deepEqual(dates.map(date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]), [
    [2026, 1, 31],
    [2026, 2, 28],
    [2026, 3, 31]
  ]);
});

test("soma grupos de parcelas em centavos", () => {
  assert.equal(plan.sumPaymentGroups([
    { quantidade: 5, valorUnitarioCentavos: 2000000 },
    { quantidade: 2, valorUnitarioCentavos: 7000000 }
  ]), 24000000);
});

test("gera vencimentos semestrais, anuais e únicos sem deslocar o dia", () => {
  const days = dates => dates.map(date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]);
  assert.deepEqual(days(plan.buildSchedule("2026-08-31", 3, "semestral")), [[2026, 8, 31], [2027, 2, 28], [2027, 8, 31]]);
  assert.deepEqual(days(plan.buildSchedule("2024-02-29", 2, "anual")), [[2024, 2, 29], [2025, 2, 28]]);
  assert.deepEqual(days(plan.buildSchedule("2024-01-31", 3, "mensal")), [[2024, 1, 31], [2024, 2, 29], [2024, 3, 31]]);
  for (const type of ["unica", "outra"]) {
    assert.deepEqual(days(plan.buildSchedule("2026-09-04", 1, type)), [[2026, 9, 4]]);
  }
});

test("vencimentos inválidos são rejeitados sem normalizar datas inexistentes", () => {
  for (const date of ["", "2026-02-29", "2026-04-31", "2026-13-01", "04/09/2026"]) {
    assert.deepEqual(plan.buildSchedule(date, 1, "mensal"), []);
  }
  for (const quantity of [0, -1, 1.5, NaN, Infinity]) {
    assert.deepEqual(plan.buildSchedule("2026-09-04", quantity, "mensal"), []);
  }
  assert.deepEqual(plan.buildSchedule("2026-09-04", 1, "invalida"), []);
  assert.equal(plan.buildSchedule("2026-09-04", "240", "mensal").length, 240);
});

test("a tabela mantém os valores da planilha sem recalcular chaves", () => {
  const values = { price: "1.000.000,00", downPayment: "100.000,00", monthlyInstallment: "2.000,00", semiannualInstallment: "10.000,00", keys: "700.000,00" };
  const formatted = plan.format(values);
  for (const key of Object.keys(values)) {
    assert.equal(plan.currencyToCents(formatted[key]), plan.currencyToCents(values[key]));
  }
  assert.equal(formatted.balanced, null);
  assert.equal(plan.calculate(values).keysCents, 76000000);
  assert.equal(plan.format({ ...values, keys: "-" }).keys, "-");
});

test("mantém a API usada pelos formulários e pela tabela de vendas", () => {
  for (const method of ["currencyToCents", "calculate", "format", "buildSchedule", "sumPaymentGroups", "percentageOfTable"]) {
    assert.equal(typeof plan[method], "function", method);
  }
  assert.equal(plan.MAX_PAYMENT_GROUPS, 12);
});
