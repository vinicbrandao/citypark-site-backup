import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";

const PaymentPlan = window.CityParkPaymentPlan;
const MAX_PAYMENT_GROUPS = PaymentPlan?.MAX_PAYMENT_GROUPS ?? 12;
const PAYMENT_LABELS = {
  mensal: "Mensal", semestral: "Semestral", anual: "Anual",
  outra: "Negociação especial", unica: "Parcela única"
};
const PAYMENT_LIMITS = { mensal: 240, semestral: 60, anual: 30, outra: 1 };

let currentStep = 1;
const totalSteps = 3;
const form = document.getElementById("proposalForm");
const formMessage = document.getElementById("formMessage");
const submitButton = form.querySelector("button[type='submit']");
let currentUser = null;
let brokerData = null;
let proposalBrokerId = null;
let adminMode = false;
let approvedBrokers = new Map();
let currentUnit = null;
let currentTableValueCents = null;
let paymentGroupSequence = 0;

document.addEventListener("DOMContentLoaded", () => {
  fillUnitFromUrl();
  setupNavigation();
  setupToggles();
  setupInputCleanup();
  setupCalculator();
  lockBrokerFields();
  updateProgress();
  loadUnitData();
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    alert("Você precisa fazer login para enviar uma proposta.");
    window.location.replace("vendas.html");
    return;
  }
  try {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search);
    const requestedAdminMode = hashParams.get("admin") === "1" || queryParams.get("admin") === "1";
    const adminSnapshot = requestedAdminMode ? await getDoc(doc(db, "admins", user.uid)) : null;
    const admin = adminSnapshot?.exists() ? adminSnapshot.data() : null;
    if (requestedAdminMode && admin?.ativo === true && admin?.tipo === "admin") {
      currentUser = user;
      adminMode = true;
      await setupAdminBrokerPicker();
      return;
    }
    const brokerSnapshot = await getDoc(doc(db, "corretores", user.uid));
    if (!brokerSnapshot.exists() || brokerSnapshot.data().aprovado !== true) {
      alert("Seu cadastro de corretor ainda não está aprovado.");
      window.location.replace("vendas.html");
      return;
    }
    currentUser = user;
    brokerData = brokerSnapshot.data();
    proposalBrokerId = user.uid;
    fillBrokerData();
  } catch (error) {
    console.error("[formulario] autenticação:", error);
    alert("Não foi possível validar seu cadastro agora.");
    window.location.replace("vendas.html");
  }
});

async function setupAdminBrokerPicker() {
  const snapshot = await getDocs(collection(db, "corretores"));
  const brokers = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    .filter(item => item.aprovado === true)
    .sort((a, b) => String(a.nome ?? a.email ?? "").localeCompare(String(b.nome ?? b.email ?? ""), "pt-BR"));
  approvedBrokers = new Map(brokers.map(item => [item.id, item]));
  const picker = document.getElementById("adminBrokerPicker");
  const select = document.getElementById("adminBrokerSelect");
  picker.classList.remove("hidden");
  select.required = true;
  select.innerHTML = `<option value="">Selecione um corretor aprovado</option>${brokers.map(item => (
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nome ?? "Sem nome")} — ${escapeHtml(item.creci ?? "CRECI não informado")} — ${escapeHtml(item.email ?? "")}</option>`
  )).join("")}`;
  select.addEventListener("change", () => {
    proposalBrokerId = select.value || null;
    brokerData = proposalBrokerId ? approvedBrokers.get(proposalBrokerId) ?? null : null;
    fillBrokerData();
  });
}

function unitDocumentId(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fillUnitFromUrl() {
  const queryParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const unit = queryParams.get("unidade") || hashParams.get("unidade") || "";
  document.getElementById("unit").value = unit;
  document.getElementById("unitPreview").textContent = unit || "Não informada";
}

async function loadUnitData() {
  const id = unitDocumentId(document.getElementById("unit").value);
  if (!id) return updateValueSummary();
  try {
    const snapshot = await getDoc(doc(db, "unidades", id));
    if (!snapshot.exists()) throw new Error("Unidade não encontrada.");
    currentUnit = { id: snapshot.id, ...snapshot.data() };
    currentTableValueCents = tableValueFromUnit(currentUnit);
    if (!Number.isInteger(currentTableValueCents)) throw new Error("A unidade não possui um valor de tabela válido.");
    updateValueSummary();
    recalculateCustomPlan();
  } catch (error) {
    currentUnit = null;
    currentTableValueCents = null;
    updateValueSummary();
    showMessage(error.message || "Não foi possível carregar os valores da unidade.", "error");
  }
}

function lockBrokerFields() {
  ["brokerName", "brokerCreci", "brokerPhone", "brokerEmail", "brokerRealEstate"].forEach(id => {
    const field = document.getElementById(id);
    field.readOnly = true;
    field.setAttribute("aria-readonly", "true");
  });
}

function fillBrokerData() {
  const values = {
    brokerName: brokerData?.nome, brokerCreci: brokerData?.creci,
    brokerPhone: brokerData?.telefone,
    brokerEmail: brokerData?.email || (adminMode ? "" : currentUser?.email),
    brokerRealEstate: brokerData?.imobiliaria
  };
  Object.entries(values).forEach(([id, value]) => { document.getElementById(id).value = value || ""; });
}

function setupNavigation() {
  document.querySelectorAll("[data-next]").forEach(button => button.addEventListener("click", nextStep));
  document.querySelectorAll("[data-previous]").forEach(button => button.addEventListener("click", previousStep));
}

function setupToggles() {
  document.querySelectorAll("input[name='clientType']").forEach(input => input.addEventListener("change", updateClientFields));
  document.querySelectorAll("input[name='proposalType']").forEach(input => input.addEventListener("change", updateProposalFields));
  updateClientFields();
  updateProposalFields();
}

function updateClientFields() {
  const type = document.querySelector("input[name='clientType']:checked").value;
  document.getElementById("physicalPersonFields").classList.toggle("hidden", type !== "fisica");
  document.getElementById("legalPersonFields").classList.toggle("hidden", type !== "juridica");
}

function selectedProposalType() {
  return document.querySelector("input[name='proposalType']:checked")?.value === "personalizada" ? "personalizada" : "padrao";
}

function updateProposalFields() {
  document.getElementById("customProposalWrap").classList.toggle("hidden", selectedProposalType() !== "personalizada");
  updateValueSummary();
  recalculateCustomPlan();
}

function setupInputCleanup() {
  form.querySelectorAll("input, textarea, select").forEach(field => {
    field.addEventListener("input", () => field.classList.remove("invalid"));
    field.addEventListener("change", () => field.classList.remove("invalid"));
  });
}

function setupCalculator() {
  if (!PaymentPlan) return showMessage("A calculadora financeira não pôde ser carregada. Atualize a página.", "error");
  const modal = document.getElementById("paymentTypeModal");
  const openButton = document.getElementById("openPaymentModal");
  const closeButton = document.getElementById("closePaymentModal");

  openButton.addEventListener("click", openPaymentTypeModal);
  closeButton.addEventListener("click", () => closePaymentTypeModal());
  modal.addEventListener("click", event => {
    if (event.target === modal) closePaymentTypeModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) closePaymentTypeModal();
  });

  document.getElementById("addPaymentButton").addEventListener("click", () => {
    const row = addPaymentGroup(document.getElementById("paymentTypeSelect").value);
    if (!row) return;
    closePaymentTypeModal({ restoreFocus: false });
    row.querySelector("[data-field='quantity']").focus();
  });
  document.getElementById("paymentGrid").addEventListener("input", event => {
    if (event.target.classList.contains("currency-input")) formatCurrencyField(event.target);
    event.target.classList.remove("invalid");
    recalculateCustomPlan();
  });
  document.getElementById("paymentGrid").addEventListener("change", event => {
    event.target.classList.remove("invalid");
    recalculateCustomPlan();
  });
  document.getElementById("dynamicPayments").addEventListener("click", event => {
    const button = event.target.closest("[data-remove-payment]");
    if (!button) return;
    button.closest("[data-payment-id]")?.remove();
    updateAddPaymentButton();
    recalculateCustomPlan();
  });
}

function openPaymentTypeModal() {
  if (document.getElementById("openPaymentModal").disabled) return;
  document.getElementById("paymentTypeModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  document.getElementById("paymentTypeSelect").focus();
}

function closePaymentTypeModal({ restoreFocus = true } = {}) {
  document.getElementById("paymentTypeModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (restoreFocus) document.getElementById("openPaymentModal").focus();
}

function addPaymentGroup(periodicity) {
  const container = document.getElementById("dynamicPayments");
  if (container.children.length >= MAX_PAYMENT_GROUPS) return null;
  const id = `payment-${++paymentGroupSequence}`;
  const isSpecial = periodicity === "outra";
  const row = document.createElement("article");
  row.className = `payment-row dynamic-payment-row enabled${isSpecial ? " is-special" : ""}`;
  row.dataset.paymentId = id;
  row.dataset.periodicity = periodicity;
  row.innerHTML = `
    <div class="payment-name"><strong>${escapeHtml(PAYMENT_LABELS[periodicity])}</strong>
      ${isSpecial ? `<label class="special-description"><span>Descrição</span><input data-field="description" type="text" maxlength="300" placeholder="Descreva a negociação"></label>` : `<small>${paymentHelp(periodicity)}</small>`}
    </div>
    <label><span>Qtd.</span><input data-field="quantity" type="number" value="1" min="1" max="${PAYMENT_LIMITS[periodicity]}" ${isSpecial ? "readonly" : ""}></label>
    <label><span>${isSpecial ? "Data" : "1º vencimento"}</span><input data-field="date" type="date"></label>
    <label><span>Valor da parcela</span><input data-field="value" class="currency-input" type="text" inputmode="decimal" placeholder="R$ 0,00"></label>
    <strong class="payment-percentage" data-payment-percentage>0%</strong>
    <strong class="payment-total" data-payment-total>R$ 0,00</strong>
    <button type="button" class="payment-remove" data-remove-payment="${id}" aria-label="Remover parcela">×</button>`;
  container.appendChild(row);
  updateAddPaymentButton();
  recalculateCustomPlan();
  return row;
}

function paymentHelp(periodicity) {
  return { mensal: "Repetição a cada mês", semestral: "Repetição a cada 6 meses", anual: "Repetição a cada 12 meses" }[periodicity] ?? "";
}

function updateAddPaymentButton() {
  const count = document.getElementById("dynamicPayments").children.length;
  const button = document.getElementById("addPaymentButton");
  const openButton = document.getElementById("openPaymentModal");
  const reachedLimit = count >= MAX_PAYMENT_GROUPS;
  button.disabled = reachedLimit;
  openButton.disabled = reachedLimit;
  openButton.title = reachedLimit ? `Limite de ${MAX_PAYMENT_GROUPS} grupos atingido` : "Adicionar parcela";
  button.textContent = reachedLimit ? `Limite de ${MAX_PAYMENT_GROUPS} grupos` : "+ Adicionar parcela";
}

function formatCurrencyField(field) {
  const digits = field.value.replace(/\D/g, "");
  field.value = digits ? formatMoney(Number(digits)) : "";
}

function nextStep() { if (validateCurrentStep() && currentStep < totalSteps) showStep(currentStep + 1); }
function previousStep() { if (currentStep > 1) showStep(currentStep - 1); }

function showStep(step) {
  currentStep = step;
  document.querySelectorAll(".form-step").forEach(section => section.classList.toggle("active", Number(section.dataset.step) === step));
  clearMessage();
  updateProgress();
  document.querySelector(".form-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateProgress() {
  document.getElementById("progressFill").style.width = `${((currentStep - 1) / (totalSteps - 1)) * 100}%`;
  document.querySelectorAll("[data-progress-step]").forEach(item => {
    const step = Number(item.dataset.progressStep);
    item.classList.toggle("active", step === currentStep);
    item.classList.toggle("complete", step < currentStep);
  });
}

function requiredFieldIds() {
  if (currentStep === 1) return adminMode
    ? ["adminBrokerSelect", "brokerName", "brokerCreci", "brokerPhone", "brokerEmail"]
    : ["brokerName", "brokerCreci", "brokerPhone", "brokerEmail"];
  if (currentStep === 2) return document.querySelector("input[name='clientType']:checked").value === "fisica"
    ? ["clientName", "clientCpf", "clientPhone", "clientEmail"]
    : ["companyName", "companyCnpj", "companyPhone", "companyEmail"];
  return ["unit"];
}

function validateCurrentStep() {
  let firstInvalid = null;
  for (const id of requiredFieldIds()) {
    const field = document.getElementById(id);
    const invalid = !field.value.trim() || !field.checkValidity();
    field.classList.toggle("invalid", invalid);
    if (invalid && !firstInvalid) firstInvalid = field;
  }
  if (firstInvalid) {
    firstInvalid.focus();
    showMessage("Preencha corretamente todos os campos obrigatórios para continuar.", "error");
    return false;
  }
  clearMessage();
  return true;
}

function showMessage(message, type) { formMessage.textContent = message; formMessage.className = `form-message ${type}`; }
function clearMessage() { formMessage.textContent = ""; formMessage.className = "form-message"; }

function buildClient() {
  const type = document.querySelector("input[name='clientType']:checked").value;
  if (type === "fisica") return {
    tipoCliente: "PF", nomeCompleto: value("clientName"), cpf: digits("clientCpf"),
    telefone: digits("clientPhone"), email: value("clientEmail").toLowerCase(),
    razaoSocial: null, cnpj: null, telefoneComercial: null, emailComercial: null
  };
  return {
    tipoCliente: "PJ", nomeCompleto: value("companyName"), cpf: null, telefone: null, email: null,
    razaoSocial: value("companyName"), cnpj: digits("companyCnpj"), telefoneComercial: digits("companyPhone"),
    emailComercial: value("companyEmail").toLowerCase()
  };
}

function value(id) { return document.getElementById(id).value.trim(); }
function digits(id) { return document.getElementById(id).value.replace(/\D/g, ""); }

function tableValueFromUnit(unit) {
  return moneyValue(unit?.valores, ["precoAVistaCentavos", "precoAVista", "precoVistaCentavos", "precoVista"]);
}

function moneyValue(source = {}, keys = []) {
  for (const key of keys) if (Number.isInteger(source?.[key])) return source[key];
  return null;
}

function readCurrencyInput(id) { return PaymentPlan?.currencyToCents(document.getElementById(id)?.value); }

function inactivePaymentComponent() {
  return { ativo: false, quantidade: 0, valorUnitarioCentavos: 0, totalCentavos: 0, periodicidade: "outra", primeiroVencimento: null, vencimentos: [], descricao: "" };
}

function paymentComponent({ quantity, unitValue, periodicity, date = null, description }) {
  const dates = date ? PaymentPlan.buildSchedule(date, quantity, periodicity) : [];
  return {
    ativo: true, quantidade: quantity, valorUnitarioCentavos: unitValue, totalCentavos: quantity * unitValue,
    periodicidade: periodicity, primeiroVencimento: dates.length ? Timestamp.fromDate(dates[0]) : null,
    vencimentos: dates.map(item => Timestamp.fromDate(item)), descricao: description
  };
}

function emptyPaymentSlots() {
  return Object.fromEntries(Array.from({ length: MAX_PAYMENT_GROUPS }, (_, index) => [
    `grupo${String(index + 1).padStart(2, "0")}`, inactivePaymentComponent()
  ]));
}

function buildStandardCondition(unit = currentUnit) {
  if (!unit) throw new Error("Aguarde o carregamento dos dados da unidade.");
  const values = unit.valores || {};
  const tableValue = tableValueFromUnit(unit);
  const signal = moneyValue(values, ["sinalCentavos", "sinal"]);
  const monthly = moneyValue(values, ["parcelasMensaisCentavos", "parcelaMensaisCentavos", "parcelasMensais", "parcelaMensais"]);
  const semiannual = moneyValue(values, ["intercaladasSemestraisCentavos", "intercaladasSemestrais"]);
  if (![tableValue, signal, monthly, semiannual].every(Number.isInteger)) throw new Error("A condição padrão desta unidade está incompleta. Revise os valores no Ambiente Administrativo.");
  const keys = tableValue - signal - PaymentPlan.MONTHLY_INSTALLMENTS * monthly - PaymentPlan.SEMIANNUAL_INSTALLMENTS * semiannual;
  if (signal <= 0 || monthly <= 0 || semiannual <= 0 || keys <= 0) throw new Error("A condição padrão desta unidade possui valores inválidos.");
  const slots = emptyPaymentSlots();
  slots.grupo01 = paymentComponent({ quantity: PaymentPlan.MONTHLY_INSTALLMENTS, unitValue: monthly, periodicity: "mensal", description: "Parcelas mensais" });
  slots.grupo02 = paymentComponent({ quantity: PaymentPlan.SEMIANNUAL_INSTALLMENTS, unitValue: semiannual, periodicity: "semestral", description: "Parcelas semestrais" });
  return {
    schemaVersao: 4, tipo: "padrao",
    descricao: `Sinal ${formatMoney(signal)} · ${PaymentPlan.MONTHLY_INSTALLMENTS} mensais de ${formatMoney(monthly)} · ${PaymentPlan.SEMIANNUAL_INSTALLMENTS} semestrais de ${formatMoney(semiannual)} · Chaves ${formatMoney(keys)}`,
    valorTabelaCentavos: tableValue, totalCalculadoCentavos: tableValue, diferencaCentavos: 0, porcentagemObra: 100,
    componentes: {
      sinal: paymentComponent({ quantity: 1, unitValue: signal, periodicity: "unica", description: "Sinal" }),
      parcelas: slots,
      chaves: paymentComponent({ quantity: 1, unitValue: keys, periodicity: "unica", description: "Chaves / financiamento" })
    }
  };
}

function collectDynamicPayments({ validate = false } = {}) {
  let firstInvalid = null;
  const groups = [...document.querySelectorAll("#dynamicPayments [data-payment-id]")].map(row => {
    const periodicity = row.dataset.periodicity;
    const quantityField = row.querySelector("[data-field='quantity']");
    const valueField = row.querySelector("[data-field='value']");
    const dateField = row.querySelector("[data-field='date']");
    const descriptionField = row.querySelector("[data-field='description']");
    const quantity = Number(quantityField.value);
    const unitValue = PaymentPlan.currencyToCents(valueField.value);
    const description = descriptionField?.value.trim() || PAYMENT_LABELS[periodicity];
    const invalidFields = [];
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > PAYMENT_LIMITS[periodicity]) invalidFields.push(quantityField);
    if (!Number.isInteger(unitValue) || unitValue <= 0) invalidFields.push(valueField);
    if (!dateField.value || PaymentPlan.buildSchedule(dateField.value, quantity, periodicity).length !== quantity) invalidFields.push(dateField);
    if (periodicity === "outra" && !descriptionField.value.trim()) invalidFields.push(descriptionField);
    if (validate) invalidFields.forEach(field => field.classList.add("invalid"));
    if (!firstInvalid && invalidFields.length) firstInvalid = invalidFields[0];
    return { row, periodicity, quantity, unitValue, date: dateField.value, description };
  });
  return { groups, firstInvalid };
}

function buildCustomCondition({ validate = true } = {}) {
  if (!currentUnit || !Number.isInteger(currentTableValueCents)) throw new Error("Aguarde o carregamento dos dados da unidade.");
  const signalValue = readCurrencyInput("paymentSinalValue");
  const signalDate = value("paymentSinalDate");
  const keysValue = readCurrencyInput("paymentChavesValue");
  const keysDate = value("paymentChavesDate");
  const invalid = [];
  if (!Number.isInteger(signalValue) || signalValue <= 0) invalid.push(document.getElementById("paymentSinalValue"));
  if (!signalDate || PaymentPlan.buildSchedule(signalDate, 1, "unica").length !== 1) invalid.push(document.getElementById("paymentSinalDate"));
  if (!Number.isInteger(keysValue) || keysValue <= 0) invalid.push(document.getElementById("paymentChavesValue"));
  if (!keysDate || PaymentPlan.buildSchedule(keysDate, 1, "unica").length !== 1) invalid.push(document.getElementById("paymentChavesDate"));
  const { groups, firstInvalid } = collectDynamicPayments({ validate });
  if (validate) invalid.forEach(field => field.classList.add("invalid"));
  const firstError = invalid[0] || firstInvalid;
  if (firstError) {
    firstError.focus();
    throw new Error("Preencha corretamente todos os valores, quantidades e vencimentos da condição.");
  }
  const total = signalValue + keysValue + PaymentPlan.sumPaymentGroups(groups.map(group => ({ quantidade: group.quantity, valorUnitarioCentavos: group.unitValue })));
  const difference = currentTableValueCents - total;
  const percentage = PaymentPlan.percentageOfTable(total, currentTableValueCents);
  if (percentage < 70) throw new Error(`A condição personalizada precisa alcançar pelo menos 70% do valor da unidade. Porcentagem atual: ${formatPercentage(percentage)}.`);
  const slots = emptyPaymentSlots();
  groups.forEach((group, index) => {
    slots[`grupo${String(index + 1).padStart(2, "0")}`] = paymentComponent({ quantity: group.quantity, unitValue: group.unitValue, periodicity: group.periodicity, date: group.date, description: group.description });
  });
  const descriptionParts = [
    `Sinal ${formatMoney(signalValue)}`,
    ...groups.map(group => `${group.quantity}x ${PAYMENT_LABELS[group.periodicity].toLowerCase()} de ${formatMoney(group.unitValue)}${group.periodicity === "outra" ? ` (${group.description})` : ""}`),
    `Chaves ${formatMoney(keysValue)}`
  ];
  return {
    schemaVersao: 4, tipo: "personalizada", descricao: descriptionParts.join(" · ").slice(0, 1000),
    valorTabelaCentavos: currentTableValueCents, totalCalculadoCentavos: total, diferencaCentavos: difference, porcentagemObra: percentage,
    componentes: {
      sinal: paymentComponent({ quantity: 1, unitValue: signalValue, periodicity: "unica", date: signalDate, description: "Sinal" }),
      parcelas: slots,
      chaves: paymentComponent({ quantity: 1, unitValue: keysValue, periodicity: "unica", date: keysDate, description: "Chaves / financiamento" })
    }
  };
}

function buildPaymentCondition(options) {
  return selectedProposalType() === "personalizada" ? buildCustomCondition(options) : buildStandardCondition();
}

function recalculateCustomPlan() {
  if (!PaymentPlan) return;
  const signal = readCurrencyInput("paymentSinalValue") || 0;
  const keys = readCurrencyInput("paymentChavesValue") || 0;
  document.querySelector("[data-payment-total='sinal']").textContent = formatMoney(signal);
  document.querySelector("[data-payment-total='chaves']").textContent = formatMoney(keys);
  document.querySelector("[data-payment-percentage='sinal']").textContent = formatPercentage(PaymentPlan.percentageOfTable(signal, currentTableValueCents));
  document.querySelector("[data-payment-percentage='chaves']").textContent = formatPercentage(PaymentPlan.percentageOfTable(keys, currentTableValueCents));
  let installmentTotal = 0;
  const { groups } = collectDynamicPayments();
  groups.forEach(group => {
    const total = Number.isInteger(group.quantity) && Number.isInteger(group.unitValue) ? group.quantity * group.unitValue : 0;
    installmentTotal += total;
    group.row.querySelector("[data-payment-total]").textContent = formatMoney(total);
    group.row.querySelector("[data-payment-percentage]").textContent = formatPercentage(PaymentPlan.percentageOfTable(total, currentTableValueCents));
  });
  const total = signal + keys + installmentTotal;
  const difference = Number.isInteger(currentTableValueCents) ? currentTableValueCents - total : null;
  updateCustomBalance(total, difference);
  updateValueSummary(total, difference);
}

function updateCustomBalance(total, difference) {
  const status = document.getElementById("proposalBalanceStatus");
  const message = document.getElementById("calculatorMessage");
  status.className = "balance-status";
  message.className = "calculator-message";
  if (!Number.isInteger(currentTableValueCents)) {
    status.textContent = "Carregando unidade";
    message.textContent = "Aguarde o carregamento do valor da tabela.";
  } else if (!total) {
    status.textContent = "Preencha a condição";
    message.textContent = "A condição personalizada precisa alcançar pelo menos 70% do valor da unidade.";
  } else if (PaymentPlan.percentageOfTable(total, currentTableValueCents) >= 100) {
    status.textContent = "Valores conferidos";
    status.classList.add("balanced");
    message.textContent = difference === 0 ? "A condição está completa e corresponde ao valor da tabela." : "A condição alcançou mais de 100% do valor da unidade.";
    message.classList.add("success");
  } else if (PaymentPlan.percentageOfTable(total, currentTableValueCents) >= 70) {
    status.textContent = "Envio permitido";
    status.classList.add("balanced");
    message.textContent = `${formatPercentage(PaymentPlan.percentageOfTable(total, currentTableValueCents))} do valor da unidade. A proposta pode ser enviada para negociação.`;
    message.classList.add("success");
  } else {
    status.textContent = "Mínimo não atingido";
    status.classList.add("unbalanced");
    message.textContent = `${formatPercentage(PaymentPlan.percentageOfTable(total, currentTableValueCents))} preenchido. Alcance pelo menos 70% para enviar.`;
    message.classList.add("error");
  }
}

function updateValueSummary(customTotal = null, customDifference = null) {
  document.getElementById("proposalTableValue").textContent = Number.isInteger(currentTableValueCents) ? formatMoney(currentTableValueCents) : "Carregando…";
  let total = customTotal;
  let difference = customDifference;
  if (selectedProposalType() === "padrao" && currentUnit) {
    try {
      const condition = buildStandardCondition();
      total = condition.totalCalculadoCentavos;
      difference = condition.diferencaCentavos;
    } catch { total = null; difference = null; }
  }
  document.getElementById("proposalFilledValue").textContent = Number.isInteger(total) ? formatMoney(total) : "—";
  document.getElementById("proposalDifferenceValue").textContent = Number.isInteger(difference) ? formatMoney(difference) : "—";
  const percentage = Number.isInteger(total) && Number.isInteger(currentTableValueCents) ? PaymentPlan.percentageOfTable(total, currentTableValueCents) : null;
  document.getElementById("proposalPercentageValue").textContent = percentage === null ? "—" : formatPercentage(percentage);
  const box = document.getElementById("proposalDifferenceBox");
  box.classList.toggle("balanced", difference === 0 && Number.isInteger(total));
  box.classList.toggle("unbalanced", Number.isInteger(difference) && difference !== 0);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!validateCurrentStep()) return;
  if (!currentUser || !brokerData || !proposalBrokerId) return showMessage("Aguarde a validação do seu cadastro de corretor.", "error");
  const declaration = document.getElementById("declaration");
  if (!declaration.checked) {
    showMessage("Confirme a declaração para enviar a proposta.", "error");
    declaration.focus();
    return;
  }
  let condition;
  try { condition = buildPaymentCondition({ validate: true }); }
  catch (error) { showMessage(error.message, "error"); return; }
  clearMessage();
  if (!await showPaymentReview(condition)) return;
  submitButton.disabled = true;
  submitButton.textContent = "Enviando…";
  try {
    await submitProposal(condition);
    clearMessage();
    showSuccessPopup();
  } catch (error) {
    console.error("[formulario] envio:", error);
    showMessage(error.message || "Não foi possível enviar a proposta.", "error");
    submitButton.disabled = false;
    submitButton.textContent = "Enviar proposta";
  }
});

function activeConditionComponents(condition) {
  return [condition.componentes.sinal, ...Object.values(condition.componentes.parcelas || {}).filter(item => item.ativo), condition.componentes.chaves];
}

function showPaymentReview(condition) {
  const client = buildClient();
  const rows = activeConditionComponents(condition).map(component => `
    <article><div><strong>${escapeHtml(component.descricao || PAYMENT_LABELS[component.periodicidade])}</strong><small>${escapeHtml(component.periodicidade === "unica" ? "Parcela única" : PAYMENT_LABELS[component.periodicidade])}</small></div>
      <span>${component.quantidade} × ${formatMoney(component.valorUnitarioCentavos)}</span><strong>${formatMoney(component.totalCentavos)}</strong></article>`).join("");
  const incompleteMessage = condition.porcentagemObra < 100
    ? `<p class="review-warning"><strong>${formatPercentage(condition.porcentagemObra)} preenchido.</strong> Deseja enviar mesmo assim?</p>`
    : "";
  return openReviewModal({
    title: "Confirme os dados da proposta", subtitle: "Confira as informações antes de enviar.", confirmText: "Enviar proposta",
    content: `<section class="review-section"><h3>Proposta</h3><div class="review-details">
      <div><span>Unidade</span><strong>${escapeHtml(value("unit"))}</strong></div><div><span>Corretor</span><strong>${escapeHtml(brokerData.nome || "Não informado")}</strong></div><div><span>Cliente</span><strong>${escapeHtml(client.nomeCompleto || client.razaoSocial)}</strong></div></div></section>
      <section class="review-section"><div class="review-section-heading"><h3>Condição de pagamento</h3><span>${condition.porcentagemObra >= 100 ? "Valores conferidos" : "Envio permitido"}</span></div><div class="review-finance-summary">
      <div><span>Valor da tabela</span><strong>${formatMoney(condition.valorTabelaCentavos)}</strong></div><div><span>Total da proposta</span><strong>${formatMoney(condition.totalCalculadoCentavos)}</strong></div><div><span>Diferença</span><strong>${formatMoney(condition.diferencaCentavos)}</strong></div><div><span>Porcentagem</span><strong>${formatPercentage(condition.porcentagemObra)}</strong></div></div>${incompleteMessage}<div class="review-installments">${rows}</div></section>`
  });
}

function openReviewModal({ title, subtitle, content, confirmText }) {
  return new Promise(resolve => {
    const modal = document.createElement("div");
    modal.className = "review-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `<div class="review-modal-card"><header class="review-modal-header"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button type="button" class="review-modal-close" aria-label="Fechar">×</button></header>
      <div class="review-modal-content">${content}</div><footer class="review-modal-actions"><button type="button" class="button button-secondary" data-modal-cancel>Voltar e editar</button><button type="button" class="button button-primary" data-modal-confirm>${escapeHtml(confirmText)}</button></footer></div>`;
    document.body.appendChild(modal);
    document.body.classList.add("modal-open");
    const finish = result => {
      document.removeEventListener("keydown", onKeydown);
      modal.remove();
      document.body.classList.remove("modal-open");
      resolve(result);
    };
    const onKeydown = event => { if (event.key === "Escape") finish(false); };
    modal.querySelector("[data-modal-confirm]").addEventListener("click", () => finish(true));
    modal.querySelector("[data-modal-cancel]").addEventListener("click", () => finish(false));
    modal.querySelector(".review-modal-close").addEventListener("click", () => finish(false));
    modal.addEventListener("click", event => { if (event.target === modal) finish(false); });
    document.addEventListener("keydown", onKeydown);
    modal.querySelector("[data-modal-confirm]").focus();
  });
}

async function submitProposal(condition) {
  const id = unitDocumentId(value("unit"));
  if (!id) throw new Error("Unidade inválida.");
  const unitRef = doc(db, "unidades", id);
  const proposalRef = doc(collection(db, "propostas"));
  const unitHistoryRef = doc(collection(db, "historico_unidades"));
  const proposalHistoryRef = doc(collection(db, "historico_propostas"));
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  await runTransaction(db, async transaction => {
    const unitSnapshot = await transaction.get(unitRef);
    if (!unitSnapshot.exists()) throw new Error("Unidade não encontrada.");
    const unit = unitSnapshot.data();
    if (unit.status !== "disponivel") throw new Error("Essa unidade não está mais disponível.");
    if (tableValueFromUnit(unit) !== condition.valorTabelaCentavos) throw new Error("O valor da unidade foi atualizado. Reabra o formulário e confira a nova condição.");
    transaction.set(proposalRef, {
      adminId: adminMode ? currentUser.uid : null, corretorId: proposalBrokerId,
      corretorSnapshot: { nome: brokerData.nome || null, creci: brokerData.creci || null, telefone: brokerData.telefone || null, email: brokerData.email || (adminMode ? null : currentUser.email) || null, imobiliaria: brokerData.imobiliaria || null },
      cliente: buildClient(), condicaoProposta: condition, declaracaoAceita: true, unidadeId: id,
      unidadeSnapshot: { unidade: unit.unidade, tipologia: unit.tipologia || null, areaM2: unit.areaM2 || null, valores: unit.valores || null },
      statusProposta: "reservada", tagsAdmin: ["Comercial em Análise"], criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(), expiraEm: expiresAt, vendidoEm: null
    });
    transaction.update(unitRef, { status: "reservada", propostaAtualId: proposalRef.id, atualizadoEm: serverTimestamp(), expiraEm: expiresAt, vendidoEm: null });
    const commonHistory = { adminId: adminMode ? currentUser.uid : null, ano: new Date().getFullYear(), corretorId: proposalBrokerId, data: serverTimestamp(), propostaId: proposalRef.id, unidade: unit.unidade, unidadeId: id, statusAnterior: "disponivel", statusNovo: "reservada" };
    transaction.set(unitHistoryRef, { ...commonHistory, acao: "unidade reservada", observacao: "Unidade reservada após o envio da proposta." });
    transaction.set(proposalHistoryRef, { ...commonHistory, acao: "proposta criada", statusAnterior: null, tags: ["Comercial em Análise"], observacao: adminMode ? "Proposta criada pelo administrador em nome do corretor selecionado." : "Proposta criada pelo corretor no site." });
  });
}

function showSuccessPopup() {
  document.querySelector(".success-popup")?.remove();
  const popup = document.createElement("div");
  popup.className = "success-popup";
  popup.setAttribute("role", "status");
  popup.setAttribute("aria-live", "polite");
  popup.innerHTML = `<div class="success-popup-card"><span class="success-popup-icon" aria-hidden="true">✓</span><h3>Proposta enviada com sucesso!</h3><p>A unidade foi reservada e a proposta completa foi encaminhada para análise.</p><div class="success-popup-actions"><a class="button button-primary" href="${adminMode ? "painel-admin.html" : "vendas.html"}">${adminMode ? "Voltar ao Ambiente Administrativo" : "Voltar para a Tabela de Vendas"}</a></div></div>`;
  document.body.appendChild(popup);
}

function formatMoney(cents) { return (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function formatPercentage(value) { return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`; }
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
