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
