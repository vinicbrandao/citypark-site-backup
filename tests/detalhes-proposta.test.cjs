const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Executa a lógica local de apresentação e montagem, sem acesso ao Firebase.
function presentation({ firebase = {}, confirm = () => true } = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { textContent: "", innerHTML: "", dataset: {}, focus() {}, classList: {
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); }
      } });
    }
    return nodes.get(id);
  };
  const context = vm.createContext({
    window: { location: { search: "?id=proposal-1", hash: "", pathname: "/detalhes-proposta.html" }, CityParkPaymentPlan: require("../js/condicao-venda.js"), confirm },
    document: { getElementById: node, body: { classList: { add() {}, remove() {} } } },
    sessionStorage: { getItem: () => null },
    onAuthStateChanged() {}, auth: {}, db: {}, URLSearchParams, Date, Intl, console,
    Timestamp: { fromDate: date => ({ toDate: () => new Date(date.getTime()) }) },
    ...firebase
  });
  const source = fs.readFileSync(path.join(__dirname, "../js/detalhes-proposta.js"), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  vm.runInContext(source, context);
  const api = vm.runInContext(`({ clientFields, proposalExpiry, expiryLabel, toDate, renderGeneralData, renderSummary, renderReservation, renderCounterproposalTotals, buildCounterproposalCondition, counterproposalDraftRows, renderCounterproposal, saveCounterproposal, deleteCounterproposal, confirmCounterproposal, openFinanceModal, saveFinanceEdit, openConfirmation, executeConfirmedAction, cancelApprovedProposal,
    setData(proposal, unit = null) { state.proposal = proposal; state.unit = unit; },
    configureActions(notify, reload, components = []) { state.adminUser = { uid: "admin-test" }; showToast = notify; loadProposal = reload; state.financeComponents = components; },
    configureCounterMode(mode, revision) { state.counterproposalMode = mode; state.editingCounterproposalRevision = dateValue(revision); }
  })`, context);
  return { ...api, node };
}

test("PF: nome antes do tipo e somente rótulos de pessoa física", () => {
  const api = presentation();
  const fields = JSON.parse(JSON.stringify(api.clientFields({ tipoCliente: "PF", nomeCompleto: "Cliente PF", cpf: "12345678901", cnpj: "12345678000190", telefone: "11999999999", email: "pf@example.test" })));
  assert.deepEqual(fields.map(field => field[0]), ["Nome", "Tipo", "CPF", "Telefone", "E-mail"]);
  assert.equal(fields[0][1], "Cliente PF");
  assert.equal(fields[1][1], "Pessoa física (PF)");
  assert.equal(fields[2][1], "123.456.789-01");
});

test("PJ: razão social, CNPJ e contatos comerciais", () => {
  const api = presentation();
  const fields = JSON.parse(JSON.stringify(api.clientFields({ tipoCliente: "PJ", razaoSocial: "Empresa exemplo", nomeCompleto: "Nome anterior", cnpj: "12345678000190", telefoneComercial: "1133334444", emailComercial: "pj@example.test" })));
  assert.deepEqual(fields.map(field => field[0]), ["Razão social", "Tipo", "CNPJ", "Telefone comercial", "E-mail comercial"]);
  assert.equal(fields[0][1], "Empresa exemplo");
  assert.equal(fields[2][1], "12.345.678/0001-90");
  assert.equal(fields[4][1], "pj@example.test");
});

test("clientes antigos: reconhece descrições do tipo e não inventa tipo ausente", () => {
  const api = presentation();
  assert.equal(api.clientFields({ tipoCliente: "Pessoa Física" })[2][0], "CPF");
  assert.equal(api.clientFields({ tipoCliente: "pessoa jurídica" })[2][0], "CNPJ");
  assert.equal(api.clientFields({ cnpj: "12345678000190" })[2][0], "CNPJ");
  assert.equal(api.clientFields({})[1][1], "Não informado");
});

test("expiração aceita Timestamp, Timestamp serializado e ISO", () => {
  const api = presentation();
  const now = Date.UTC(2030, 0, 1, 12);
  const date = new Date(now + 150 * 60000);
  for (const value of [{ toDate: () => date }, { seconds: date.getTime() / 1000, nanoseconds: 0 }, { _seconds: date.getTime() / 1000 }, date.toISOString(), date.getTime()]) {
    const label = api.expiryLabel("reservada", value, now);
    assert.match(label, /^Expira em: /);
    assert.match(label, /2030/);
    assert.match(label, /2h e 30min/);
  }
  assert.match(api.expiryLabel("pendente", date, now), /2h e 30min/);
});

test("prazo vencido, ausente ou inválido não é tratado como expiração futura", () => {
  const api = presentation();
  const now = Date.UTC(2030, 0, 1, 12);
  assert.match(api.expiryLabel("reservada", now - 1000, now), /^Expirou em: .*prazo encerrado/);
  for (const value of [null, undefined, "inválida", { seconds: NaN }, { toDate: () => new Date(NaN) }]) {
    assert.match(api.expiryLabel("reservada", value, now), /prazo não informado/);
  }
  assert.equal(api.expiryLabel("aprovada", now + 60000, now), "Sem prazo de expiração ativo.");
  assert.equal(api.expiryLabel("recusada", null, now), "Sem prazo de expiração ativo.");
});

test("alternativa na unidade exige vínculo com a mesma proposta e respeita remoção explícita", () => {
  const api = presentation();
  const unit = { propostaAtualId: "proposal-1", expiraEm: "2030-01-01" };
  assert.equal(api.proposalExpiry({ id: "proposal-1" }, unit), unit.expiraEm);
  assert.equal(api.proposalExpiry({ id: "proposal-2" }, unit), null);
  assert.equal(api.proposalExpiry({ id: "proposal-1", expiraEm: null }, unit), null);
  assert.equal(api.proposalExpiry({ id: "proposal-1", expiraEm: "2031-01-01" }, unit), "2031-01-01");
});

test("renderização mantém resumo e dados PF/PJ consistentes e texto escapado", () => {
  const api = presentation();
  api.setData({ id: "proposal-1", criadoEm: "2030-01-01", cliente: { tipoCliente: "PF", nomeCompleto: "Ana <teste>", cpf: "12345678901" } });
  api.renderSummary();
  api.renderGeneralData();
  assert.match(api.node("summaryDocument").textContent, /^CPF: /);
  assert.match(api.node("clientInformation").innerHTML, /^<div><dt>Nome<\/dt>/);
  assert.match(api.node("clientInformation").innerHTML, /Ana &lt;teste&gt;/);
  assert.doesNotMatch(api.node("clientInformation").innerHTML, /CNPJ/);
  api.setData({ id: "proposal-1", cliente: { tipoCliente: "PJ", razaoSocial: "Empresa", cnpj: "12345678000190" } });
  api.renderSummary();
  api.renderGeneralData();
  assert.match(api.node("summaryDocument").textContent, /^CNPJ: /);
  assert.match(api.node("clientInformation").innerHTML, /^<div><dt>Razão social<\/dt>/);
});

test("situação apresenta o prazo da unidade vinculada sem alterar ações de aprovação", () => {
  const api = presentation();
  api.setData({ id: "proposal-1", statusProposta: "reservada" }, { propostaAtualId: "proposal-1", expiraEm: "2099-01-01T12:00:00Z" });
  api.renderReservation();
  assert.match(api.node("expiryText").textContent, /^Expira em: /);
  assert.equal(api.node("proposalActions").hidden, false);
  assert.equal(api.node("cancelamento-proposta").hidden, true);
});

test("cancelamento principal aparece somente para proposta aprovada", () => {
  const api = presentation();
  for (const status of ["reservada", "vendida", "cancelada", "recusada"]) {
    api.setData({ id: "proposal-1", statusProposta: status });
    api.renderReservation();
    assert.equal(api.node("cancelamento-proposta").hidden, true, status);
  }
  api.setData({ id: "proposal-1", statusProposta: "aprovada" });
  api.renderReservation();
  assert.equal(api.node("cancelamento-proposta").hidden, false);
  assert.equal(api.node("proposalActions").hidden, true);
});

test("indicador de contraproposta fica laranja somente enquanto estiver pendente", () => {
  const api = presentation();
  const counterTag = () => api.node("reservationTags").innerHTML.match(/<span class="process-tag ([^"]*)">Contraproposta<\/span>/)?.[1];
  for (const status of [undefined, "aceita", "cancelada", "excluida"]) {
    api.setData({ id:"proposal-1", statusProposta:"reservada", contrapropostaAtual:status ? { status } : undefined });
    api.renderReservation();
    assert.equal(counterTag(), "locked", String(status));
  }
  api.setData({ id:"proposal-1", statusProposta:"reservada", contrapropostaAtual:{ status:"pendente" } });
  api.renderReservation();
  assert.equal(counterTag(), "pending");
  assert.match(api.node("reservationTags").innerHTML, /process-tag pending">Análise comercial/);
});

function counterRow(type, quantity, value, dueDate = "2026-09-04") {
  const fields = {
    "[data-counter-type]": { value: type },
    "[data-counter-quantity]": { value: quantity },
    "[data-counter-value]": { value },
    "[data-counter-date]": { value: dueDate },
    "[data-counter-row-percentage]": { textContent: "" }
  };
  return { querySelector: selector => fields[selector] };
}

test("contraproposta: atualiza os quatro indicadores e o percentual de cada grupo", () => {
  const api = presentation();
  api.setData({}, { valores: { precoAVistaCentavos: 10000000 } });
  const signal = counterRow("sinal", "1", "10.000,00");
  const monthly = counterRow("mensal", "10", "1.000,00");
  const keys = counterRow("chaves", "1", "80.000,00");
  const rows = [signal, monthly, keys];
  api.node("counterproposalRows").querySelectorAll = () => rows;
  api.renderCounterproposalTotals();
  assert.match(api.node("counterTableValue").textContent, /100\.000,00/);
  assert.match(api.node("counterTotalValue").textContent, /100\.000,00/);
  assert.match(api.node("counterDifference").textContent, /0,00/);
  assert.equal(api.node("counterPercentage").textContent, "100%");
  assert.equal(api.node("counterDifferenceCard").classList.contains("unbalanced"), false);
  assert.equal(signal.querySelector("[data-counter-quantity]").value, "1");
  assert.equal(keys.querySelector("[data-counter-quantity]").readOnly, false);
  assert.equal(monthly.querySelector("[data-counter-quantity]").readOnly, false);
  assert.deepEqual(rows.map(row => row.querySelector("[data-counter-row-percentage]").textContent), ["10%", "10%", "80%"]);

  monthly.querySelector("[data-counter-value]").value = "2.000,00";
  api.renderCounterproposalTotals();
  assert.match(api.node("counterTotalValue").textContent, /110\.000,00/);
  assert.match(api.node("counterDifference").textContent, /-R\$\s*10\.000,00/);
  assert.equal(api.node("counterPercentage").textContent, "110%");
  assert.equal(api.node("counterDifferenceCard").classList.contains("unbalanced"), true);

  rows.pop();
  api.renderCounterproposalTotals();
  assert.match(api.node("counterDifference").textContent, /70\.000,00/);
  assert.equal(api.node("counterPercentage").textContent, "30%");
});

test("contraproposta: campos vazios e valor de tabela ausente não geram NaN", () => {
  const api = presentation();
  api.setData({});
  const monthly = counterRow("mensal", "", "");
  api.node("counterproposalRows").querySelectorAll = () => [monthly];
  api.renderCounterproposalTotals();
  assert.equal(api.node("counterTableValue").textContent, "—");
  assert.equal(api.node("counterDifference").textContent, "—");
  assert.match(api.node("counterTotalValue").textContent, /0,00/);
  assert.equal(api.node("counterPercentage").textContent, "0%");
  assert.equal(monthly.querySelector("[data-counter-row-percentage]").textContent, "0%");
  assert.equal(api.node("counterDifferenceCard").classList.contains("unbalanced"), false);
});

test("contraproposta: monta a condição completa com vencimentos e preserva a original", () => {
  const api = presentation();
  const original = { tipo: "padrao", totalCalculadoCentavos: 10000000 };
  const proposal = { condicaoProposta: original };
  api.setData(proposal, { valores: { precoAVistaCentavos: 10000000 } });
  const rows = [
    counterRow("sinal", "1", "10.000,00"),
    counterRow("mensal", "3", "1.000,00", "2027-01-31"),
    counterRow("semestral", "2", "2.000,00"),
    counterRow("anual", "2", "3.000,00"),
    counterRow("outra", "1", "5.000,00"),
    counterRow("chaves", "1", "72.000,00")
  ];
  api.node("counterproposalRows").querySelectorAll = () => rows;
  const condition = api.buildCounterproposalCondition();
  assert.equal(condition.schemaVersao, 4);
  assert.equal(condition.tipo, "personalizada");
  assert.equal(condition.totalCalculadoCentavos, 10000000);
  assert.equal(condition.diferencaCentavos, 0);
  assert.equal(condition.porcentagemObra, 100);
  assert.equal(Object.keys(condition.componentes.parcelas).length, 12);
  const groups = [condition.componentes.sinal, ...Object.values(condition.componentes.parcelas), condition.componentes.chaves];
  for (const group of groups.filter(group => group.ativo)) {
    assert.equal(group.vencimentos.length, group.quantidade);
    assert.ok(Number.isFinite(group.primeiroVencimento.toDate().getTime()));
  }
  assert.deepEqual(Array.from(condition.componentes.parcelas.grupo01.vencimentos, timestamp => timestamp.toDate().getDate()), [31, 28, 31]);
  assert.equal(proposal.condicaoProposta, original);
  assert.equal(proposal.contrapropostaAtual, undefined);
});

test("contraproposta: mantém a validação de data e a exigência de sinal e chaves", () => {
  const api = presentation();
  api.setData({}, { valores: { precoAVistaCentavos: 10000000 } });
  const rows = [counterRow("sinal", "1", "10.000,00"), counterRow("mensal", "3", "1.000,00", "2026-02-30")];
  api.node("counterproposalRows").querySelectorAll = () => rows;
  assert.throws(() => api.buildCounterproposalCondition(), /Preencha tipo, quantidade, valor e vencimento/);
  rows[1].querySelector("[data-counter-date]").value = "2026-02-28";
  assert.throws(() => api.buildCounterproposalCondition(), /linha de Sinal e uma de Chaves/);
});

test("sinal e chaves parcelados: quantidades, totais e vencimentos mensais", () => {
  const api = presentation();
  api.setData({}, { valores: { precoAVistaCentavos: 10000000 } });
  const signal = counterRow("sinal", "3", "10.000,00", "2027-01-31");
  const keys = counterRow("chaves", "7", "10.000,00", "2027-01-31");
  api.node("counterproposalRows").querySelectorAll = () => [signal, keys];
  api.renderCounterproposalTotals();
  assert.equal(signal.querySelector("[data-counter-quantity]").value, "3");
  assert.equal(signal.querySelector("[data-counter-quantity]").readOnly, false);
  assert.equal(keys.querySelector("[data-counter-quantity]").value, "7");
  assert.equal(keys.querySelector("[data-counter-quantity]").readOnly, false);
  assert.equal(signal.querySelector("[data-counter-row-percentage]").textContent, "30%");
  assert.equal(keys.querySelector("[data-counter-row-percentage]").textContent, "70%");
  const condition = api.buildCounterproposalCondition();
  assert.equal(condition.totalCalculadoCentavos, 10000000);
  assert.equal(condition.diferencaCentavos, 0);
  for (const key of ["sinal", "chaves"]) {
    const component = condition.componentes[key];
    assert.equal(component.periodicidade, "mensal");
    assert.equal(component.vencimentos.length, component.quantidade);
    assert.deepEqual(Array.from(component.vencimentos.slice(0, 3), timestamp => timestamp.toDate().getDate()), [31, 28, 31]);
  }
  for (const row of [signal, keys]) {
    const previous = row.querySelector("[data-counter-quantity]").value;
    for (const invalid of ["0", "-1", "1.5", "241"]) {
      row.querySelector("[data-counter-quantity]").value = invalid;
      assert.throws(() => api.buildCounterproposalCondition(), /Preencha tipo/);
    }
    row.querySelector("[data-counter-quantity]").value = previous;
  }
});

function counterActionHarness({ confirm = () => true, serverStatus = "pendente", replaced = false, fail = false } = {}) {
  const original = { schemaVersao: 4, totalCalculadoCentavos: 10000000 };
  const counter = { status: "pendente", abertaEm: "2026-09-04T12:00:00Z", condicao: { schemaVersao: 4, totalCalculadoCentavos: 9000000 } };
  const proposal = { id: "proposal-1", statusProposta: "reservada", condicaoProposta: original, contrapropostaAtual: counter };
  const serverProposal = { ...proposal, contrapropostaAtual: { ...counter, status: serverStatus, abertaEm: replaced ? "2026-09-04T13:00:00Z" : counter.abertaEm } };
  const deleted = Symbol("deleteField");
  const updates = [], histories = [], notifications = [];
  let calls = 0, reloads = 0;
  const api = presentation({ confirm, firebase: {
    doc: (...args) => args.slice(1).join("/") || "history-test",
    collection: (_db, name) => name,
    deleteField: () => deleted,
    serverTimestamp: () => "server-time",
    console: { error() {} },
    runTransaction: async (_db, callback) => {
      calls++;
      const stagedUpdates = [], stagedHistories = [];
      await callback({
        get: async () => ({ exists: () => true, data: () => serverProposal }),
        update: (ref, data) => stagedUpdates.push({ ref, data }),
        set: (ref, data) => stagedHistories.push({ ref, data })
      });
      if (fail) throw new Error("Falha de gravação simulada");
      updates.push(...stagedUpdates);
      histories.push(...stagedHistories);
    }
  } });
  api.setData(proposal);
  api.configureActions((message, error) => notifications.push({ message, error }), async () => { reloads++; });
  const buttons = [{ disabled: false }, { disabled: false }];
  api.node("counterproposalDisplay").querySelectorAll = () => buttons;
  return { api, proposal, original, counter, deleted, updates, histories, notifications, buttons, calls: () => calls, reloads: () => reloads };
}

test("exclusão: remove somente a contraproposta e registra histórico na mesma transação", async () => {
  const h = counterActionHarness();
  await h.api.deleteCounterproposal();
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].data.contrapropostaAtual, h.deleted);
  assert.equal(Object.hasOwn(h.updates[0].data, "condicaoProposta"), false);
  assert.equal(Object.hasOwn(h.updates[0].data, "statusProposta"), false);
  assert.equal(h.proposal.condicaoProposta, h.original);
  assert.equal(h.histories.length, 1);
  assert.equal(h.histories[0].data.acao, "contraproposta excluída");
  assert.equal(h.reloads(), 1);
  assert.ok(h.buttons.every(button => !button.disabled));
});

test("exclusão cancelada não grava nada", async () => {
  const h = counterActionHarness({ confirm: () => false });
  await h.api.deleteCounterproposal();
  assert.equal(h.calls(), 0);
  assert.equal(h.updates.length, 0);
});

test("exclusão recusa contraproposta já aceita ou substituída", async () => {
  for (const options of [{ serverStatus: "aceita" }, { replaced: true }]) {
    const h = counterActionHarness(options);
    await h.api.deleteCounterproposal();
    assert.equal(h.updates.length, 0);
    assert.equal(h.histories.length, 0);
    assert.equal(h.notifications[0].error, true);
    assert.ok(h.buttons.every(button => !button.disabled));
  }
});

test("falha ao excluir mantém dados e reabilita os botões", async () => {
  const h = counterActionHarness({ fail: true });
  await h.api.deleteCounterproposal();
  assert.equal(h.updates.length, 0);
  assert.equal(h.histories.length, 0);
  assert.equal(h.reloads(), 0);
  assert.equal(h.proposal.contrapropostaAtual, h.counter);
  assert.match(h.notifications[0].message, /Falha de gravação/);
  assert.ok(h.buttons.every(button => !button.disabled));
});

test("confirmar continua substituindo a original e bloqueia ação simultânea de exclusão", async () => {
  const h = counterActionHarness();
  const pending = h.api.confirmCounterproposal();
  assert.ok(h.buttons.every(button => button.disabled));
  await h.api.deleteCounterproposal();
  await pending;
  assert.equal(h.calls(), 1);
  assert.equal(h.updates[0].data.condicaoProposta, h.counter.condicao);
  assert.equal(h.updates[0].data.contrapropostaAtual.status, "aceita");
  assert.equal(h.histories[0].data.acao, "contraproposta aceita");
});

test("botão de exclusão aparece antes da confirmação somente para contraproposta pendente", () => {
  const h = counterActionHarness();
  h.api.renderCounterproposal();
  const html = h.api.node("counterproposalDisplay").innerHTML;
  assert.ok(html.indexOf("data-delete-counterproposal") >= 0);
  assert.ok(html.indexOf("data-delete-counterproposal") < html.indexOf("data-confirm-counterproposal"));
  h.proposal.contrapropostaAtual.status = "aceita";
  h.api.renderCounterproposal();
  assert.equal(h.api.node("counterproposalDisplay").hidden, true);
  assert.equal(h.api.node("counterproposalDisplay").innerHTML, "");
});

test("contraproposta pendente oferece edição antes das ações definitivas", () => {
  const h = counterActionHarness();
  h.api.renderCounterproposal();
  const html = h.api.node("counterproposalDisplay").innerHTML;
  const edit = html.indexOf("data-edit-counterproposal");
  const remove = html.indexOf("data-delete-counterproposal");
  const confirm = html.indexOf("data-confirm-counterproposal");
  assert.ok(edit >= 0 && edit < remove && remove < confirm);
});

test("converte a condição pendente nos mesmos campos do formulário", () => {
  const api = presentation();
  const condition = {
    componentes: {
      sinal: { ativo:true, quantidade:2, periodicidade:"mensal", valorUnitarioCentavos:100000, primeiroVencimento:"2027-01-31" },
      parcelas: {
        grupo01: { ativo:true, quantidade:3, periodicidade:"semestral", valorUnitarioCentavos:200000, primeiroVencimento:"2027-02-28" },
        grupo02: { ativo:false, quantidade:0 }
      },
      chaves: { ativo:true, quantidade:1, periodicidade:"unica", valorUnitarioCentavos:500000, primeiroVencimento:"2028-01-15" }
    }
  };
  assert.deepEqual(JSON.parse(JSON.stringify(api.counterproposalDraftRows(condition))), [
    { type:"sinal", quantity:2, dueDate:"2027-01-31", value:100000 },
    { type:"semestral", quantity:3, dueDate:"2027-02-28", value:200000 },
    { type:"chaves", quantity:1, dueDate:"2028-01-15", value:500000 }
  ]);
});

function counterEditHarness({ replaced = false, fail = false } = {}) {
  const condition = { schemaVersao:4, totalCalculadoCentavos:9000000 };
  const current = { status:"pendente", abertaEm:"2026-09-04T12:00:00Z", abertaPor:"admin-original", condicao:condition };
  const proposal = { id:"proposal-1", unidadeId:"unit-1", statusProposta:"reservada", condicaoProposta:{ totalCalculadoCentavos:10000000 }, contrapropostaAtual:current };
  const serverProposal = { ...proposal, contrapropostaAtual:{ ...current, atualizadaEm:replaced ? "2026-09-04T13:00:00Z" : undefined } };
  const updates = [], histories = [], notifications = [];
  let reloads = 0;
  const api = presentation({ firebase:{
    doc: (...args) => args.slice(1).join("/") || "history-test",
    collection: (_db, name) => name,
    serverTimestamp: () => "server-time",
    console: { error() {} },
    runTransaction: async (_db, callback) => {
      const stagedUpdates = [], stagedHistories = [];
      await callback({
        get: async () => ({ exists:() => true, data:() => serverProposal }),
        update: (ref, data) => stagedUpdates.push({ ref, data }),
        set: (ref, data) => stagedHistories.push({ ref, data })
      });
      if (fail) throw new Error("Falha de edição simulada");
      updates.push(...stagedUpdates); histories.push(...stagedHistories);
    }
  } });
  api.setData(proposal, { valores:{ precoAVistaCentavos:10000000 } });
  api.configureActions((message, error) => notifications.push({ message, error }), async () => { reloads++; });
  api.configureCounterMode("edit", current.abertaEm);
  api.node("counterproposalRows").querySelectorAll = () => [counterRow("sinal", "2", "10.000,00"), counterRow("chaves", "1", "80.000,00")];
  api.node("counterproposalForm").querySelector = () => ({ disabled:false });
  return { api, proposal, current, updates, histories, notifications, reloads:() => reloads };
}

test("edição atualiza somente a contraproposta pendente e registra histórico", async () => {
  const h = counterEditHarness();
  await h.api.saveCounterproposal({ preventDefault() {} });
  assert.equal(h.updates.length, 1);
  const update = h.updates[0].data;
  assert.equal(Object.hasOwn(update, "condicaoProposta"), false);
  assert.equal(update.contrapropostaAtual.status, "pendente");
  assert.equal(update.contrapropostaAtual.abertaEm, h.current.abertaEm);
  assert.equal(update.contrapropostaAtual.abertaPor, "admin-original");
  assert.equal(update.contrapropostaAtual.atualizadaPor, "admin-test");
  assert.equal(update.contrapropostaAtual.condicao.totalCalculadoCentavos, 10000000);
  assert.equal(h.histories[0].data.acao, "contraproposta editada");
  assert.equal(h.reloads(), 1);
  assert.equal(h.proposal.condicaoProposta.totalCalculadoCentavos, 10000000);
});

test("edição não sobrescreve uma contraproposta alterada por outra sessão", async () => {
  const h = counterEditHarness({ replaced:true });
  await h.api.saveCounterproposal({ preventDefault() {} });
  assert.equal(h.updates.length, 0);
  assert.equal(h.histories.length, 0);
  assert.match(h.api.node("counterproposalError").textContent, /alterada por outra sessão/);
  assert.equal(h.api.node("counterproposalError").hidden, false);
});

test("edição da condição permite parcelar sinal e chaves e voltar a parcela única", async () => {
  for (const key of ["sinal", "chaves"]) {
    for (const quantity of [3, 1]) {
      const h = counterActionHarness();
      const source = { key, label: key, descricao: key, ativo: true, quantidade: 1, periodicidade: "unica", valorUnitarioCentavos: 100000, totalCentavos: 100000, primeiroVencimento: "2027-01-31" };
      h.original.componentes = { [key]: source, parcelas: {} };
      h.api.configureActions(() => {}, async () => {}, [source]);
      h.api.openFinanceModal(key);
      assert.equal(h.api.node("editQuantity").disabled, false);
      assert.equal(h.api.node("editQuantity").max, "240");
      h.api.node("editQuantity").value = String(quantity);
      await h.api.saveFinanceEdit({ preventDefault() {} });
      const component = h.updates[0].data.condicaoProposta.componentes[key];
      assert.equal(component.quantidade, quantity);
      assert.equal(component.totalCentavos, quantity * 100000);
      assert.equal(component.periodicidade, quantity > 1 ? "mensal" : "unica");
      assert.equal(component.vencimentos.length, quantity);
    }
  }
});

function cancellationHarness({ proposalStatus = "aprovada", unitStatus = "aprovada", currentProposalId = "proposal-1", fail = false } = {}) {
  const proposal = { id:"proposal-1", unidadeId:"unit-1", corretorId:"broker-1", statusProposta:proposalStatus, condicaoProposta:{ tipo:"personalizada" }, contrapropostaAtual:{ status:"pendente", abertaEm:"2026-09-04", condicao:{ totalCalculadoCentavos:9000000 } } };
  const serverProposal = { ...proposal };
  const serverUnit = { id:"unit-1", unidade:"804 A", status:unitStatus, propostaAtualId:currentProposalId };
  const deleted = Symbol("deleteField");
  const updates = [], histories = [], notifications = [];
  let calls = 0, reloads = 0;
  const api = presentation({ firebase: {
    doc: (...args) => args.slice(1).join("/") || "generated-history",
    collection: (_db, name) => name,
    deleteField: () => deleted,
    serverTimestamp: () => "server-time",
    console: { error() {} },
    runTransaction: async (_db, callback) => {
      calls++;
      const stagedUpdates = [], stagedHistories = [];
      await callback({
        get: async ref => ({ exists: () => true, data: () => String(ref).startsWith("propostas/") ? serverProposal : serverUnit }),
        update: (ref, data) => stagedUpdates.push({ ref, data }),
        set: (ref, data) => stagedHistories.push({ ref, data })
      });
      if (fail) throw new Error("Falha de cancelamento simulada");
      updates.push(...stagedUpdates);
      histories.push(...stagedHistories);
    }
  } });
  api.setData(proposal, serverUnit);
  api.configureActions((message, error) => notifications.push({ message, error }), async () => { reloads++; });
  return { api, proposal, serverUnit, deleted, updates, histories, notifications, calls: () => calls, reloads: () => reloads };
}

test("cancelamento aprovado altera proposta e libera a unidade na mesma transação", async () => {
  const h = cancellationHarness();
  await h.api.cancelApprovedProposal("Solicitação formal do cliente");
  assert.equal(h.calls(), 1);
  assert.equal(h.updates.length, 2);
  const proposalUpdate = h.updates.find(item => item.ref === "propostas/proposal-1").data;
  const unitUpdate = h.updates.find(item => item.ref === "unidades/unit-1").data;
  assert.equal(proposalUpdate.statusProposta, "cancelada");
  assert.equal(proposalUpdate.observacaoCancelamento, "Solicitação formal do cliente");
  assert.equal(proposalUpdate.contrapropostaAtual.status, "cancelada");
  assert.equal(proposalUpdate.contrapropostaAtual.canceladaPor, "admin-test");
  assert.deepEqual(Array.from(proposalUpdate.tagsAdmin), []);
  assert.equal(unitUpdate.status, "disponivel");
  assert.equal(unitUpdate.propostaAtualId, null);
  assert.equal(unitUpdate.propostaId, h.deleted);
  assert.equal(h.histories.length, 2);
  assert.deepEqual(h.histories.map(item => item.data.acao).sort(), ["proposta cancelada", "unidade disponível"]);
  assert.equal(h.histories.find(item => item.data.acao === "proposta cancelada").data.observacao, "Solicitação formal do cliente");
  assert.equal(h.proposal.statusProposta, "aprovada");
});

test("cancelamento não libera unidade de outra proposta nem estados incompatíveis", async () => {
  for (const options of [{ proposalStatus:"vendida" }, { unitStatus:"vendida" }, { currentProposalId:"proposal-2" }]) {
    const h = cancellationHarness(options);
    await assert.rejects(() => h.api.cancelApprovedProposal("Motivo válido"));
    assert.equal(h.updates.length, 0);
    assert.equal(h.histories.length, 0);
  }
});

test("falha no cancelamento não deixa atualização parcial", async () => {
  const h = cancellationHarness({ fail:true });
  await assert.rejects(() => h.api.cancelApprovedProposal("Motivo válido"), /Falha de cancelamento/);
  assert.equal(h.updates.length, 0);
  assert.equal(h.histories.length, 0);
});

test("modal de cancelamento exige justificativa e usa a ação destrutiva", async () => {
  const h = cancellationHarness();
  h.api.openConfirmation("cancel");
  assert.equal(h.api.node("confirmationTitle").textContent, "Cancelar esta proposta aprovada?");
  assert.equal(h.api.node("actionReasonLabel").textContent, "Motivo do cancelamento");
  assert.equal(h.api.node("confirmAction").className, "danger-button");
  assert.equal(h.api.node("rejectionReasonField").hidden, false);
  h.api.node("rejectionReason").value = "   ";
  await h.api.executeConfirmedAction();
  assert.equal(h.calls(), 0);
  assert.equal(h.api.node("rejectionReasonError").hidden, false);
  h.api.node("rejectionReason").value = "Motivo informado";
  await h.api.executeConfirmedAction();
  assert.equal(h.calls(), 1);
  assert.equal(h.reloads(), 1);
  assert.match(h.notifications[0].message, /cancelada e unidade liberada/);
});

test("a nova seção não foi adicionada à sidebar", () => {
  const html = fs.readFileSync(path.join(__dirname, "../detalhes-proposta.html"), "utf8");
  const sidebar = html.match(/<aside class="anchor-sidebar">([\s\S]*?)<\/aside>/)?.[1] || "";
  assert.doesNotMatch(sidebar, /cancelamento-proposta/);
  assert.match(html, /<section id="cancelamento-proposta"[^>]*hidden>/);
  assert.ok(html.indexOf('id="cancelamento-proposta"') > html.indexOf('id="historico"'));
});

test("proposta cancelada não permite exibir ou confirmar contraproposta", async () => {
  const h = counterActionHarness({ serverStatus:"pendente" });
  h.proposal.statusProposta = "cancelada";
  h.api.setData(h.proposal);
  h.api.renderCounterproposal();
  assert.equal(h.api.node("openCounterproposal").hidden, true);
  assert.equal(h.api.node("counterproposalDisplay").hidden, true);
  assert.equal(h.api.node("counterproposalDisplay").innerHTML, "");
});
