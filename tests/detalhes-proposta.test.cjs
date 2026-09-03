const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Executa apenas a lógica de apresentação, sem autenticação ou acesso ao Firebase.
function presentation() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", innerHTML: "", dataset: {}, classList: { toggle() {} } });
    return nodes.get(id);
  };
  const context = vm.createContext({
    window: { location: { search: "?id=proposal-1", hash: "", pathname: "/detalhes-proposta.html" } },
    document: { getElementById: node },
    sessionStorage: { getItem: () => null },
    onAuthStateChanged() {}, auth: {}, db: {}, URLSearchParams, Date, Intl, console
  });
  const source = fs.readFileSync(path.join(__dirname, "../js/detalhes-proposta.js"), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  vm.runInContext(source, context);
  const api = vm.runInContext(`({ clientFields, proposalExpiry, expiryLabel, toDate, renderGeneralData, renderSummary, renderReservation,
    setData(proposal, unit = null) { state.proposal = proposal; state.unit = unit; }
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
});
