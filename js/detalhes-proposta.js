import { auth, db } from "./firebase.js";

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";

const PaymentPlan = window.CityParkPaymentPlan;
const $ = id => document.getElementById(id);
const elements = {
  loading: $("loadingState"), app: $("proposalApp"), logout: $("btnSair"),
  proposalId: $("summaryProposalId"), createdAt: $("summaryCreatedAt"), unit: $("summaryUnit"), broker: $("summaryBroker"), creci: $("summaryCreci"), client: $("summaryClient"), clientDocument: $("summaryDocument"),
  actions: $("proposalActions"), approve: $("approveProposal"), reject: $("rejectProposal"), status: $("proposalStatus"), expiry: $("expiryText"), tags: $("reservationTags"),
  brokerTab: $("brokerTab"), clientTab: $("clientTab"), brokerPanel: $("brokerPanel"), clientPanel: $("clientPanel"), brokerInformation: $("brokerInformation"), clientInformation: $("clientInformation"),
  financeType: $("financeConditionType"), financeValidation: $("financeValidation"), tableValue: $("financeTableValue"), proposalValue: $("financeProposalValue"), difference: $("financeDifference"), differenceCard: $("financeDifferenceCard"), percentage: $("financePercentage"), financeRows: $("financeRows"),
  openCounterproposal: $("openCounterproposal"), counterproposalForm: $("counterproposalForm"), closeCounterproposal: $("closeCounterproposal"), cancelCounterproposal: $("cancelCounterproposal"), addCounterproposalRow: $("addCounterproposalRow"), counterproposalRows: $("counterproposalRows"), counterTableValue: $("counterTableValue"), counterTotalValue: $("counterTotalValue"), counterPercentage: $("counterPercentage"), counterproposalError: $("counterproposalError"), counterproposalDisplay: $("counterproposalDisplay"),
  history: $("historyTimeline"), confirmationModal: $("confirmationModal"), confirmationIcon: $("confirmationIcon"), confirmationTitle: $("confirmationTitle"), confirmationText: $("confirmationText"), reasonField: $("rejectionReasonField"), reason: $("rejectionReason"), reasonError: $("rejectionReasonError"), confirmAction: $("confirmAction"),
  financeModal: $("financeModal"), financeForm: $("financeEditForm"), editDescription: $("editDescription"), editQuantity: $("editQuantity"), editValue: $("editValue"), editDueDate: $("editDueDate"), editError: $("editFinanceError"), saveFinance: $("saveFinance"), toast: $("toast")
};

const state = {
  adminUser: null, admin: null, proposalId: resolveProposalId(), proposal: null, unit: null, broker: null,
  financeComponents: [], modalAction: null, editingKey: null, counterRowSequence: 0, initialized: false, toastTimer: null
};

onAuthStateChanged(auth, async user => {
  if (!user) return location.replace("vendas.html");
  try {
    const adminSnapshot = await getDoc(doc(db, "admins", user.uid));
    const admin = adminSnapshot.exists() ? adminSnapshot.data() : null;
    if (!admin || admin.ativo !== true || admin.tipo !== "admin") {
      window.alert("Acesso restrito a administradores ativos.");
      return location.replace("vendas.html");
    }
    if (!state.proposalId) {
      window.location.replace("gestao-propostas.html");
      return;
    }
    state.adminUser = user;
    state.admin = admin;
    document.documentElement.classList.add("page-authorized");
    bindEvents();
    await loadProposal();
  } catch (error) {
    console.error("[detalhes-proposta] inicialização:", error);
    document.documentElement.classList.add("page-authorized");
    elements.loading.innerHTML = `<p>${escapeHtml(error.message || "Não foi possível abrir a proposta.")}</p><a href="gestao-propostas.html">Voltar às propostas</a>`;
  }
});

function bindEvents() {
  if (state.initialized) return;
  state.initialized = true;
  elements.logout.addEventListener("click", async () => { await signOut(auth); location.replace("vendas.html"); });
  elements.brokerTab.addEventListener("click", () => showDataTab("broker"));
  elements.clientTab.addEventListener("click", () => showDataTab("client"));
  elements.approve.addEventListener("click", () => openConfirmation("approve"));
  elements.reject.addEventListener("click", () => openConfirmation("reject"));
  elements.confirmAction.addEventListener("click", executeConfirmedAction);
  document.querySelectorAll("[data-close-modal]").forEach(button => button.addEventListener("click", closeConfirmation));
  document.querySelectorAll("[data-close-finance]").forEach(button => button.addEventListener("click", closeFinanceModal));
  elements.confirmationModal.addEventListener("click", event => { if (event.target === elements.confirmationModal) closeConfirmation(); });
  elements.financeModal.addEventListener("click", event => { if (event.target === elements.financeModal) closeFinanceModal(); });
  elements.financeRows.addEventListener("click", event => {
    const button = event.target.closest("[data-edit-component]");
    if (button && !button.disabled) openFinanceModal(button.dataset.editComponent);
  });
  elements.financeForm.addEventListener("submit", saveFinanceEdit);
  elements.openCounterproposal.addEventListener("click", openCounterproposalBuilder);
  elements.closeCounterproposal.addEventListener("click", closeCounterproposalBuilder);
  elements.cancelCounterproposal.addEventListener("click", closeCounterproposalBuilder);
  elements.addCounterproposalRow.addEventListener("click", () => addCounterproposalRow("mensal"));
  elements.counterproposalForm.addEventListener("submit", saveCounterproposal);
  elements.counterproposalRows.addEventListener("input", renderCounterproposalTotals);
  elements.counterproposalRows.addEventListener("change", renderCounterproposalTotals);
  elements.counterproposalRows.addEventListener("click", event => {
    const remove = event.target.closest("[data-remove-counter-row]");
    if (remove) { remove.closest("[data-counter-row]")?.remove(); renderCounterproposalTotals(); }
  });
  elements.counterproposalDisplay.addEventListener("click", event => {
    if (event.target.closest("[data-confirm-counterproposal]")) confirmCounterproposal();
  });
  elements.editValue.addEventListener("blur", () => {
    const cents = PaymentPlan?.currencyToCents(elements.editValue.value);
    if (Number.isInteger(cents)) elements.editValue.value = formatMoney(cents);
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!elements.financeModal.hidden) closeFinanceModal();
    else if (!elements.confirmationModal.hidden) closeConfirmation();
  });
  observeSections();
  observeSummaryLayout();
  window.setInterval(() => { if (state.proposal) renderExpiry(); }, 60000);
}

async function loadProposal() {
  const proposalSnapshot = await getDoc(doc(db, "propostas", state.proposalId));
  if (!proposalSnapshot.exists()) throw new Error("A proposta solicitada não foi encontrada.");
  state.proposal = { id: proposalSnapshot.id, ...proposalSnapshot.data() };
  try { sessionStorage.setItem("cityparkAdminProposalId", state.proposalId); } catch { /* URL ainda mantém o ID. */ }
  const [unitSnapshot, brokerSnapshot] = await Promise.all([
    state.proposal.unidadeId ? getDoc(doc(db, "unidades", state.proposal.unidadeId)) : null,
    state.proposal.corretorId ? getDoc(doc(db, "corretores", state.proposal.corretorId)) : null
  ]);
  state.unit = unitSnapshot?.exists() ? { id: unitSnapshot.id, ...unitSnapshot.data() } : null;
  state.broker = brokerSnapshot?.exists() ? { id: brokerSnapshot.id, ...brokerSnapshot.data() } : null;
  renderAll();
  await loadHistory();
  elements.loading.hidden = true;
  elements.app.hidden = false;
  updateSummaryHeight();
}

function renderAll() {
  renderSummary();
  renderReservation();
  renderGeneralData();
  renderFinance();
  renderCounterproposal();
  document.title = `${state.proposal.id} | City Park`;
}

function renderSummary() {
  const broker = brokerData();
  const client = state.proposal.cliente || {};
  elements.proposalId.textContent = state.proposal.id;
  elements.createdAt.textContent = formatDate(state.proposal.criadoEm);
  elements.unit.textContent = unitData().unidade || state.proposal.unidadeId || "—";
  elements.broker.textContent = broker.nome || "Não informado";
  elements.creci.textContent = broker.creci ? `CRECI: ${broker.creci}` : "CRECI: não informado";
  elements.client.textContent = clientName(client);
  const clientDocument = clientFields(client)[2];
  elements.clientDocument.textContent = `${clientDocument[0]}: ${clientDocument[1]}`;
  [elements.proposalId, elements.unit, elements.broker, elements.creci, elements.client, elements.clientDocument].forEach(element => { element.title = element.textContent; });
}

function renderReservation() {
  const status = normalizeStatus(state.proposal.statusProposta);
  const group = statusGroup(status);
  elements.status.textContent = statusLabel(status);
  elements.status.dataset.group = group;
  elements.actions.hidden = status !== "reservada";
  renderExpiry();
  const stages = ["Análise comercial", "Validação de documentos", "Aguardando assinatura", "Envio Sienge", "Cancelada", "Distrato", "Contraproposta", "Vendida"];
  const approved = ["aprovada", "vendida"].includes(status);
  elements.tags.innerHTML = stages.map((label, index) => {
    const className = index === 0 ? (status === "reservada" ? "pending" : approved ? "complete" : "locked") : approved ? "" : "locked";
    return `<span class="process-tag ${className}">${escapeHtml(label)}</span>`;
  }).join("");
}

function renderExpiry() {
  elements.expiry.textContent = expiryLabel(state.proposal.statusProposta, proposalExpiry(state.proposal, state.unit));
}

function renderGeneralData() {
  const broker = brokerData();
  const client = state.proposal.cliente || {};
  elements.brokerInformation.innerHTML = [
    detail("Nome", broker.nome), detail("CPF", formatCpfCnpj(broker.cpf)), detail("CRECI", broker.creci), detail("Telefone", formatPhone(broker.telefone)), detail("E-mail", broker.email), detail("Imobiliária", broker.imobiliaria || broker.razaoSocial), detail("Criado em", formatDate(broker.criadoEm))
  ].join("");
  elements.clientInformation.innerHTML = clientFields(client).map(([label, value]) => detail(label, value)).join("");
}

function showDataTab(tab) {
  const brokerActive = tab === "broker";
  elements.brokerPanel.hidden = !brokerActive;
  elements.clientPanel.hidden = brokerActive;
  elements.brokerTab.classList.toggle("active", brokerActive);
  elements.clientTab.classList.toggle("active", !brokerActive);
  elements.brokerTab.setAttribute("aria-selected", String(brokerActive));
  elements.clientTab.setAttribute("aria-selected", String(!brokerActive));
}

function renderFinance() {
  const condition = state.proposal.condicaoProposta || {};
  const components = structuredComponents(condition);
  state.financeComponents = components;
  const rows = components.length ? components : legacyFinanceRows(condition);
  const tableValue = Number.isInteger(condition.valorTabelaCentavos) ? condition.valorTabelaCentavos : unitTableValue();
  const calculated = Number.isInteger(condition.totalCalculadoCentavos) ? condition.totalCalculadoCentavos : rows.reduce((sum, row) => sum + (Number(row.totalCentavos) || 0), 0);
  const difference = Number.isInteger(condition.diferencaCentavos) ? condition.diferencaCentavos : (Number.isInteger(tableValue) ? tableValue - calculated : null);
  const balanced = Number.isInteger(tableValue) && calculated === tableValue;
  const percentage = Number.isFinite(Number(condition.porcentagemObra)) ? Number(condition.porcentagemObra) : percentageOfTable(calculated, tableValue);
  elements.tableValue.textContent = formatMoney(tableValue);
  elements.proposalValue.textContent = formatMoney(calculated);
  elements.difference.textContent = formatMoney(difference);
  elements.percentage.textContent = formatPercentage(percentage);
  elements.differenceCard.classList.toggle("unbalanced", !balanced);
  const customCondition = ["outro", "personalizada", "personalizado"].includes(normalizeStatus(condition.tipo));
  elements.financeType.textContent = customCondition ? "Personalizado" : "Padrão";
  elements.financeValidation.textContent = percentage >= 70 ? (balanced ? "Valores conferidos" : "Negociação permitida") : "Revisão necessária";
  elements.financeValidation.classList.toggle("invalid", percentage < 70);
  elements.financeRows.innerHTML = rows.length
    ? renderFinanceTableRows(rows, condition.schemaVersao >= 3)
    : `<tr><td class="empty-table" colspan="6">A condição financeira desta proposta não possui dados estruturados.</td></tr>`;
}

function renderFinanceTableRows(rows, currentSchema) {
  const groups = new Map();
  rows.forEach(row => {
    const groupKey = row.key === "sinal" ? "sinal" : row.key === "chaves" ? "chaves" : row.periodicidade || row.label;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  });
  return [...groups.entries()].flatMap(([groupKey, groupRows]) => groupRows.map((row, index) => {
    const canEdit = currentSchema && Boolean(row.key);
    const groupCell = index === 0 ? `<td rowspan="${groupRows.length}">${escapeHtml(financeGroupLabel(groupKey, row.label))}</td>` : "";
    const tableValue = Number.isInteger(state.proposal?.condicaoProposta?.valorTabelaCentavos) ? state.proposal.condicaoProposta.valorTabelaCentavos : unitTableValue();
    return `<tr>${groupCell}<td>${escapeHtml(row.quantidade || "—")}</td><td>${escapeHtml(formatDateOnly(row.primeiroVencimento))}</td><td>${formatMoney(row.valorUnitarioCentavos)}</td><td>${formatPercentage(percentageOfTable(row.totalCentavos, tableValue))}</td><td><button class="edit-finance-button" type="button" data-edit-component="${escapeHtml(row.key || "")}" ${canEdit ? "" : "disabled title=\"Edição disponível apenas para propostas na estrutura atual\""} aria-label="Editar ${escapeHtml(row.label)}">✎</button></td></tr>`;
  })).join("");
}

function financeGroupLabel(groupKey, fallback) {
  return { sinal:"Sinal", mensal:"Mensais", semestral:"Semestrais", anual:"Anuais", outra:"Outro", unica:"Parcela única", chaves:"Chaves / financiamento" }[groupKey] || fallback || "Parcela";
}

function structuredComponents(condition) {
  const source = condition.componentes;
  if (!source || typeof source !== "object") return [];
  if (condition.schemaVersao >= 3 && source.parcelas && typeof source.parcelas === "object") {
    const installmentRows = Object.entries(source.parcelas).sort(([a], [b]) => a.localeCompare(b)).map(([key, component]) => ({ key, label: component?.descricao || periodicityLabel(component?.periodicidade), ...(component || {}) }));
    return [{ key: "sinal", label: "Sinal", ...(source.sinal || {}) }, ...installmentRows, { key: "chaves", label: "Chaves / financiamento", ...(source.chaves || {}) }].filter(item => item.ativo);
  }
  const labels = { sinal:"Sinal", mensais:"Parcelas mensais", semestrais:"Parcelas semestrais", anuais:"Parcelas anuais", negociacaoEspecial:"Negociação especial", chaves:"Chaves / financiamento" };
  return Object.entries(labels).map(([key, label]) => ({ key, label, ...(source[key] || {}) })).filter(item => item.ativo);
}

function legacyFinanceRows(condition) {
  if (normalizeStatus(condition.tipo) !== "padrao") return [];
  const values = unitData().valores || {};
  const data = [["Sinal",1,moneyValue(values,["sinalCentavos","sinal"])],["Parcelas mensais",80,moneyValue(values,["parcelasMensaisCentavos","parcelasMensais"])],["Parcelas semestrais",12,moneyValue(values,["intercaladasSemestraisCentavos","intercaladasSemestrais"])],["Chaves / financiamento",1,moneyValue(values,["chavesCentavos","chaves"])]];
  return data.filter(([, , value]) => Number.isInteger(value)).map(([label, quantidade, valor]) => ({ label, quantidade, valorUnitarioCentavos:valor, totalCentavos:quantidade*valor, primeiroVencimento:null }));
}

function openConfirmation(action) {
  state.modalAction = action;
  const approving = action === "approve";
  elements.confirmationIcon.textContent = approving ? "✓" : "!";
  elements.confirmationIcon.className = `modal-icon ${approving ? "success" : "danger"}`;
  elements.confirmationTitle.textContent = approving ? "Aprovar esta proposta?" : "Recusar esta proposta?";
  elements.confirmationText.textContent = approving ? "A proposta será aprovada e o temporizador de expiração será removido." : "A proposta ficará inativa e a unidade voltará a ficar disponível.";
  elements.confirmAction.textContent = approving ? "Sim, aprovar proposta" : "Confirmar recusa";
  elements.confirmAction.className = approving ? "primary-button" : "danger-button";
  elements.reasonField.hidden = approving;
  elements.reason.value = "";
  elements.reasonError.hidden = true;
  elements.confirmationModal.hidden = false;
  document.body.classList.add("modal-open");
  (approving ? elements.confirmAction : elements.reason).focus();
}

function closeConfirmation() {
  if (elements.confirmAction.disabled) return;
  elements.confirmationModal.hidden = true;
  document.body.classList.remove("modal-open");
  state.modalAction = null;
}

async function executeConfirmedAction() {
  const reason = elements.reason.value.trim();
  if (state.modalAction === "reject" && !reason) {
    elements.reasonError.hidden = false;
    elements.reason.focus();
    return;
  }
  elements.confirmAction.disabled = true;
  try {
    if (state.modalAction === "approve") await approveProposal();
    else if (state.modalAction === "reject") await rejectProposal(reason);
    elements.confirmationModal.hidden = true;
    document.body.classList.remove("modal-open");
    showToast(state.modalAction === "approve" ? "Proposta aprovada e expiração removida." : "Proposta recusada e unidade liberada.");
    state.modalAction = null;
    await loadProposal();
  } catch (error) {
    console.error("[detalhes-proposta] ação:", error);
    showToast(error.message || "Não foi possível concluir a ação.", true);
  } finally {
    elements.confirmAction.disabled = false;
  }
}

async function approveProposal() {
  requireLinkedUnit();
  const proposalRef = doc(db, "propostas", state.proposalId);
  const unitRef = doc(db, "unidades", state.proposal.unidadeId);
  const unitHistoryRef = doc(collection(db, "historico_unidades"));
  const proposalHistoryRef = doc(collection(db, "historico_propostas"));
  await runTransaction(db, async transaction => {
    const [proposalSnapshot, unitSnapshot] = await Promise.all([transaction.get(proposalRef), transaction.get(unitRef)]);
    if (!proposalSnapshot.exists() || !unitSnapshot.exists()) throw new Error("Proposta ou unidade não encontrada.");
    const proposal = proposalSnapshot.data();
    const unit = unitSnapshot.data();
    if (normalizeStatus(proposal.statusProposta) !== "reservada" || normalizeStatus(unit.status) !== "reservada") throw new Error("O status foi alterado por outra sessão. Atualize a página.");
    const common = historyCommon(proposal, unit, "reservada", "aprovada");
    transaction.update(proposalRef, { statusProposta:"aprovada", adminId:state.adminUser.uid, tagsAdmin:["Análise comercial"], atualizadoEm:serverTimestamp(), expiraEm:null, vendidoEm:null });
    transaction.update(unitRef, { status:"aprovada", propostaAtualId:state.proposalId, propostaId:deleteField(), atualizadoEm:serverTimestamp(), expiraEm:null, vendidoEm:null });
    transaction.set(unitHistoryRef, { ...common, acao:"unidade aprovada", observacao:"Proposta aprovada e expiração removida." });
    transaction.set(proposalHistoryRef, { ...common, acao:"proposta aprovada", observacao:"Proposta aprovada pelo administrador." });
  });
}

async function rejectProposal(reason) {
  requireLinkedUnit();
  const proposalRef = doc(db, "propostas", state.proposalId);
  const unitRef = doc(db, "unidades", state.proposal.unidadeId);
  const unitHistoryRef = doc(collection(db, "historico_unidades"));
  const proposalHistoryRef = doc(collection(db, "historico_propostas"));
  await runTransaction(db, async transaction => {
    const [proposalSnapshot, unitSnapshot] = await Promise.all([transaction.get(proposalRef), transaction.get(unitRef)]);
    if (!proposalSnapshot.exists() || !unitSnapshot.exists()) throw new Error("Proposta ou unidade não encontrada.");
    const proposal = proposalSnapshot.data();
    const unit = unitSnapshot.data();
    if (normalizeStatus(proposal.statusProposta) !== "reservada" || normalizeStatus(unit.status) !== "reservada") throw new Error("Esta proposta não pode mais ser recusada.");
    const common = historyCommon(proposal, unit, "reservada", "recusada");
    transaction.update(proposalRef, { statusProposta:"recusada", adminId:state.adminUser.uid, observacaoAdmin:reason, observacaoRecusa:reason, tagsAdmin:[], atualizadoEm:serverTimestamp(), expiraEm:null, vendidoEm:null });
    transaction.update(unitRef, { status:"disponivel", propostaAtualId:null, propostaId:deleteField(), atualizadoEm:serverTimestamp(), expiraEm:null, vendidoEm:null });
    transaction.set(unitHistoryRef, { ...common, statusNovo:"disponivel", acao:"unidade disponível", observacao:"Unidade liberada após a recusa da proposta." });
    transaction.set(proposalHistoryRef, { ...common, acao:"proposta recusada", observacao:reason });
  });
}

function openFinanceModal(key) {
  const component = state.financeComponents.find(item => item.key === key);
  if (!component || state.proposal.condicaoProposta?.schemaVersao < 3) return;
  state.editingKey = key;
  elements.editDescription.value = component.descricao || component.label || "";
  elements.editQuantity.value = component.quantidade || 1;
  elements.editQuantity.disabled = ["sinal", "chaves"].includes(key);
  elements.editQuantity.max = String({ mensal:240, semestral:60, anual:30, outra:1, unica:1 }[component.periodicidade] || 120);
  elements.editValue.value = formatMoney(component.valorUnitarioCentavos);
  elements.editDueDate.value = dateInputValue(component.primeiroVencimento);
  elements.editError.hidden = true;
  elements.financeModal.hidden = false;
  document.body.classList.add("modal-open");
  elements.editDescription.focus();
}

function closeFinanceModal(force = false) {
  if (elements.saveFinance.disabled && !force) return;
  elements.financeModal.hidden = true;
  document.body.classList.remove("modal-open");
  state.editingKey = null;
}

async function saveFinanceEdit(event) {
  event.preventDefault();
  const key = state.editingKey;
  const source = state.financeComponents.find(item => item.key === key);
  if (!source) return;
  const description = elements.editDescription.value.trim();
  const quantity = Number(elements.editQuantity.value);
  const maxQuantity = Number(elements.editQuantity.max);
  const unitValue = PaymentPlan?.currencyToCents(elements.editValue.value);
  const dueDate = elements.editDueDate.value;
  const schedule = PaymentPlan?.buildSchedule(dueDate, quantity, source.periodicidade);
  if (!description || !Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity || !Number.isInteger(unitValue) || unitValue <= 0 || !schedule || schedule.length !== quantity) {
    elements.editError.textContent = "Preencha descrição, quantidade, valor e vencimento corretamente.";
    elements.editError.hidden = false;
    return;
  }
  elements.saveFinance.disabled = true;
  try {
    const current = state.proposal.condicaoProposta || {};
    const componentes = { ...(current.componentes || {}), parcelas:{ ...(current.componentes?.parcelas || {}) } };
    const updatedComponent = { ...source, descricao:description, quantidade:quantity, valorUnitarioCentavos:unitValue, totalCentavos:quantity*unitValue, primeiroVencimento:Timestamp.fromDate(schedule[0]), vencimentos:schedule.map(date => Timestamp.fromDate(date)) };
    delete updatedComponent.key;
    delete updatedComponent.label;
    if (key === "sinal" || key === "chaves") componentes[key] = updatedComponent;
    else componentes.parcelas[key] = updatedComponent;
    const active = [componentes.sinal, ...Object.values(componentes.parcelas).filter(item => item?.ativo), componentes.chaves].filter(Boolean);
    const total = active.reduce((sum, component) => sum + (Number(component.totalCentavos) || 0), 0);
    const table = Number.isInteger(current.valorTabelaCentavos) ? current.valorTabelaCentavos : unitTableValue();
    const descriptionText = active.map(component => `${component.quantidade}x ${component.descricao} de ${formatMoney(component.valorUnitarioCentavos)}`).join(" · ").slice(0,1000);
    const condition = { ...current, componentes, descricao:descriptionText, totalCalculadoCentavos:total, diferencaCentavos:Number.isInteger(table) ? table-total : null, porcentagemObra:percentageOfTable(total, table) };
    const proposalRef = doc(db, "propostas", state.proposalId);
    const historyRef = doc(collection(db, "historico_propostas"));
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(proposalRef);
      if (!snapshot.exists()) throw new Error("A proposta não foi encontrada.");
      transaction.update(proposalRef, { condicaoProposta:condition, adminId:state.adminUser.uid, atualizadoEm:serverTimestamp() });
      transaction.set(historyRef, { adminId:state.adminUser.uid, ano:new Date().getFullYear(), corretorId:state.proposal.corretorId || null, data:serverTimestamp(), propostaId:state.proposalId, unidade:unitData().unidade || null, unidadeId:state.proposal.unidadeId || null, statusAnterior:state.proposal.statusProposta || null, statusNovo:state.proposal.statusProposta || null, acao:"condição financeira editada", observacao:`${source.label} alterado: ${quantity} parcela(s) de ${formatMoney(unitValue)}.` });
    });
    closeFinanceModal(true);
    showToast("Condição financeira atualizada.");
    await loadProposal();
  } catch (error) {
    console.error("[detalhes-proposta] edição financeira:", error);
    elements.editError.textContent = error.message || "Não foi possível salvar a alteração.";
    elements.editError.hidden = false;
  } finally {
    elements.saveFinance.disabled = false;
  }
}

function openCounterproposalBuilder() {
  elements.counterproposalForm.hidden = false;
  elements.openCounterproposal.hidden = true;
  elements.counterTableValue.textContent = formatMoney(unitTableValue());
  elements.counterproposalError.hidden = true;
  if (!elements.counterproposalRows.children.length) {
    addCounterproposalRow("sinal");
    addCounterproposalRow("mensal");
    addCounterproposalRow("chaves");
  }
  elements.counterproposalForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeCounterproposalBuilder() {
  elements.counterproposalForm.hidden = true;
  elements.openCounterproposal.hidden = normalizeStatus(state.proposal?.contrapropostaAtual?.status) === "pendente";
  elements.counterproposalError.hidden = true;
}

function addCounterproposalRow(type = "mensal") {
  if (elements.counterproposalRows.children.length >= 14) return;
  const id = `counter-${++state.counterRowSequence}`;
  const row = document.createElement("div");
  row.className = "counterproposal-row";
  row.dataset.counterRow = id;
  row.innerHTML = `
    <label><span>Tipo de parcela</span><select data-counter-type>
      <option value="sinal" ${type === "sinal" ? "selected" : ""}>Sinal</option>
      <option value="mensal" ${type === "mensal" ? "selected" : ""}>Mensal</option>
      <option value="semestral" ${type === "semestral" ? "selected" : ""}>Semestral</option>
      <option value="anual" ${type === "anual" ? "selected" : ""}>Anual</option>
      <option value="outra" ${type === "outra" ? "selected" : ""}>Negociação especial</option>
      <option value="chaves" ${type === "chaves" ? "selected" : ""}>Chaves / financiamento</option>
    </select></label>
    <label><span>Quantidade</span><input data-counter-quantity type="number" min="1" max="240" value="1"></label>
    <label><span>Data de vencimento</span><input data-counter-date type="date"></label>
    <label><span>Valor unitário</span><input data-counter-value type="text" inputmode="decimal" placeholder="R$ 0,00"></label>
    <span class="counter-row-percentage" data-counter-row-percentage>0%</span>
    <button type="button" data-remove-counter-row aria-label="Remover parcela">×</button>`;
  elements.counterproposalRows.appendChild(row);
  renderCounterproposalTotals();
}

function renderCounterproposalTotals() {
  const tableValue = unitTableValue();
  let total = 0;
  [...elements.counterproposalRows.querySelectorAll("[data-counter-row]")].forEach(row => {
    const type = row.querySelector("[data-counter-type]").value;
    const quantityField = row.querySelector("[data-counter-quantity]");
    const single = type === "sinal" || type === "chaves" || type === "outra";
    if (single) quantityField.value = "1";
    quantityField.readOnly = single;
    const quantity = Number(quantityField.value);
    const value = PaymentPlan?.currencyToCents(row.querySelector("[data-counter-value]").value);
    const rowTotal = Number.isInteger(quantity) && Number.isInteger(value) ? quantity * value : 0;
    total += rowTotal;
    row.querySelector("[data-counter-row-percentage]").textContent = formatPercentage(percentageOfTable(rowTotal, tableValue));
  });
  elements.counterTotalValue.textContent = formatMoney(total);
  elements.counterPercentage.textContent = formatPercentage(percentageOfTable(total, tableValue));
}

function buildCounterproposalCondition() {
  const tableValue = unitTableValue();
  if (!Number.isInteger(tableValue)) throw new Error("O valor da unidade não está disponível.");
  const rows = [...elements.counterproposalRows.querySelectorAll("[data-counter-row]")];
  if (!rows.length) throw new Error("Adicione pelo menos uma parcela.");
  const slots = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`grupo${String(index + 1).padStart(2, "0")}`, inactiveCounterComponent()]));
  let signal = null;
  let keys = null;
  let groupIndex = 0;
  const description = [];
  for (const row of rows) {
    const rawType = row.querySelector("[data-counter-type]").value;
    const periodicity = ["sinal", "chaves"].includes(rawType) ? "unica" : rawType;
    const quantity = Number(row.querySelector("[data-counter-quantity]").value);
    const unitValue = PaymentPlan?.currencyToCents(row.querySelector("[data-counter-value]").value);
    const dueDate = row.querySelector("[data-counter-date]").value;
    const max = { unica: 1, mensal: 240, semestral: 60, anual: 30, outra: 1 }[periodicity];
    const schedule = PaymentPlan?.buildSchedule(dueDate, quantity, periodicity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > max || !Number.isInteger(unitValue) || unitValue <= 0 || !schedule || schedule.length !== quantity) {
      throw new Error("Preencha tipo, quantidade, valor e vencimento de todas as parcelas.");
    }
    const label = { sinal: "Sinal", mensal: "Parcelas mensais", semestral: "Parcelas semestrais", anual: "Parcelas anuais", outra: "Negociação especial", chaves: "Chaves / financiamento" }[rawType];
    const component = { ativo: true, quantidade: quantity, valorUnitarioCentavos: unitValue, totalCentavos: quantity * unitValue, periodicidade: periodicity, primeiroVencimento: Timestamp.fromDate(schedule[0]), vencimentos: schedule.map(date => Timestamp.fromDate(date)), descricao: label };
    if (rawType === "sinal") {
      if (signal) throw new Error("Use apenas uma linha de Sinal.");
      signal = component;
    } else if (rawType === "chaves") {
      if (keys) throw new Error("Use apenas uma linha de Chaves / financiamento.");
      keys = component;
    } else {
      if (groupIndex >= 12) throw new Error("A contraproposta aceita no máximo 12 grupos de parcelas.");
      slots[`grupo${String(++groupIndex).padStart(2, "0")}`] = component;
    }
    description.push(`${quantity}x ${label} de ${formatMoney(unitValue)}`);
  }
  if (!signal || !keys) throw new Error("A contraproposta precisa ter uma linha de Sinal e uma de Chaves / financiamento.");
  const total = [signal, ...Object.values(slots), keys].reduce((sum, item) => sum + item.totalCentavos, 0);
  return { schemaVersao: 4, tipo: "personalizada", descricao: description.join(" · ").slice(0, 1000), valorTabelaCentavos: tableValue, totalCalculadoCentavos: total, diferencaCentavos: tableValue - total, porcentagemObra: percentageOfTable(total, tableValue), componentes: { sinal: signal, parcelas: slots, chaves: keys } };
}

function inactiveCounterComponent() {
  return { ativo: false, quantidade: 0, valorUnitarioCentavos: 0, totalCentavos: 0, periodicidade: "outra", primeiroVencimento: null, vencimentos: [], descricao: "" };
}

async function saveCounterproposal(event) {
  event.preventDefault();
  let condition;
  try { condition = buildCounterproposalCondition(); }
  catch (error) { elements.counterproposalError.textContent = error.message; elements.counterproposalError.hidden = false; return; }
  const submit = elements.counterproposalForm.querySelector("button[type='submit']");
  submit.disabled = true;
  elements.counterproposalError.hidden = true;
  try {
    const proposalRef = doc(db, "propostas", state.proposalId);
    const historyRef = doc(collection(db, "historico_propostas"));
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(proposalRef);
      if (!snapshot.exists()) throw new Error("A proposta não foi encontrada.");
      const proposal = snapshot.data();
      if (normalizeStatus(proposal.contrapropostaAtual?.status) === "pendente") throw new Error("Já existe uma contraproposta aguardando confirmação.");
      transaction.update(proposalRef, { contrapropostaAtual: { status: "pendente", abertaEm: serverTimestamp(), abertaPor: state.adminUser.uid, condicao: condition }, adminId: state.adminUser.uid, atualizadoEm: serverTimestamp() });
      transaction.set(historyRef, { adminId: state.adminUser.uid, ano: new Date().getFullYear(), corretorId: proposal.corretorId || null, data: serverTimestamp(), propostaId: state.proposalId, unidade: unitData().unidade || null, unidadeId: proposal.unidadeId || null, statusAnterior: proposal.statusProposta || null, statusNovo: proposal.statusProposta || null, acao: "contraproposta criada", observacao: `Contraproposta aberta com total de ${formatMoney(condition.totalCalculadoCentavos)} (${formatPercentage(condition.porcentagemObra)} do valor da unidade).` });
    });
    elements.counterproposalRows.innerHTML = "";
    closeCounterproposalBuilder();
    showToast("Contraproposta salva e aguardando confirmação.");
    await loadProposal();
  } catch (error) {
    console.error("[detalhes-proposta] contraproposta:", error);
    elements.counterproposalError.textContent = error.message || "Não foi possível salvar a contraproposta.";
    elements.counterproposalError.hidden = false;
  } finally { submit.disabled = false; }
}

function renderCounterproposal() {
  const counterproposal = state.proposal.contrapropostaAtual;
  const pending = normalizeStatus(counterproposal?.status) === "pendente";
  elements.openCounterproposal.hidden = pending || !elements.counterproposalForm.hidden;
  elements.counterproposalDisplay.hidden = !pending;
  if (!pending) { elements.counterproposalDisplay.innerHTML = ""; return; }
  const condition = counterproposal.condicao || {};
  const rows = structuredComponents(condition);
  elements.counterproposalDisplay.innerHTML = `
    <div class="counterproposal-title"><div><span>Contraproposta</span><strong>Aberta em ${escapeHtml(formatDate(counterproposal.abertaEm))}</strong></div><span class="pending-counter">Aguardando confirmação</span></div>
    <div class="finance-totals counter-totals"><div><span>Valor da tabela</span><strong>${formatMoney(condition.valorTabelaCentavos)}</strong></div><div><span>Total preenchido</span><strong>${formatMoney(condition.totalCalculadoCentavos)}</strong></div><div><span>Diferença</span><strong>${formatMoney(condition.diferencaCentavos)}</strong></div><div><span>Porcentagem</span><strong>${formatPercentage(condition.porcentagemObra)}</strong></div></div>
    <div class="finance-table-wrap counter-table-wrap"><table class="finance-table"><thead><tr><th>Parcelas</th><th>Qtd.</th><th>Vencimento</th><th>Valor</th><th>Porcentagem</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(financeGroupLabel(row.key === "sinal" ? "sinal" : row.key === "chaves" ? "chaves" : row.periodicidade, row.label))}</td><td>${row.quantidade}</td><td>${escapeHtml(formatDateOnly(row.primeiroVencimento))}</td><td>${formatMoney(row.valorUnitarioCentavos)}</td><td>${formatPercentage(percentageOfTable(row.totalCentavos, condition.valorTabelaCentavos))}</td></tr>`).join("")}</tbody></table></div>
    <button class="primary-button confirm-counterproposal" type="button" data-confirm-counterproposal>Confirmar e substituir proposta original</button>`;
}

async function confirmCounterproposal() {
  if (!window.confirm("Confirmar a contraproposta e substituir a condição original?")) return;
  const button = elements.counterproposalDisplay.querySelector("[data-confirm-counterproposal]");
  button.disabled = true;
  try {
    const proposalRef = doc(db, "propostas", state.proposalId);
    const historyRef = doc(collection(db, "historico_propostas"));
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(proposalRef);
      if (!snapshot.exists()) throw new Error("A proposta não foi encontrada.");
      const proposal = snapshot.data();
      const counterproposal = proposal.contrapropostaAtual;
      if (normalizeStatus(counterproposal?.status) !== "pendente" || !counterproposal?.condicao) throw new Error("A contraproposta não está mais pendente.");
      transaction.update(proposalRef, { condicaoProposta: counterproposal.condicao, contrapropostaAtual: { ...counterproposal, status: "aceita", confirmadaEm: serverTimestamp(), confirmadaPor: state.adminUser.uid }, adminId: state.adminUser.uid, atualizadoEm: serverTimestamp() });
      transaction.set(historyRef, { adminId: state.adminUser.uid, ano: new Date().getFullYear(), corretorId: proposal.corretorId || null, data: serverTimestamp(), propostaId: state.proposalId, unidade: unitData().unidade || null, unidadeId: proposal.unidadeId || null, statusAnterior: proposal.statusProposta || null, statusNovo: proposal.statusProposta || null, acao: "contraproposta aceita", observacao: `A contraproposta substituiu a condição financeira original. Novo total: ${formatMoney(counterproposal.condicao.totalCalculadoCentavos)}.` });
    });
    showToast("Contraproposta confirmada e condição original substituída.");
    await loadProposal();
  } catch (error) {
    console.error("[detalhes-proposta] confirmação da contraproposta:", error);
    showToast(error.message || "Não foi possível confirmar a contraproposta.", true);
    button.disabled = false;
  }
}

async function loadHistory() {
  try {
    const snapshot = await getDocs(query(collection(db, "historico_propostas"), where("propostaId", "==", state.proposalId)));
    const items = snapshot.docs.map(item => ({ id:item.id, ...item.data() })).sort((a,b) => dateValue(b.data)-dateValue(a.data));
    elements.history.innerHTML = items.length ? items.map(item => `<article class="history-event"><p>Data: ${escapeHtml(formatDate(item.data))}</p><p>Ação: ${escapeHtml(item.acao || "Ação registrada")}</p><p>Status anterior: ${escapeHtml(statusLabel(item.statusAnterior))}</p><p>Status novo: ${escapeHtml(statusLabel(item.statusNovo))}</p><p>Observação: ${escapeHtml(item.observacao || "-")}</p></article>`).join("") : `<div class="history-empty">Ainda não há eventos registrados para esta proposta.</div>`;
  } catch (error) {
    console.error("[detalhes-proposta] histórico:", error);
    elements.history.innerHTML = `<div class="history-empty">Não foi possível carregar o histórico.</div>`;
  }
}

function updateSummaryHeight() {
  const summary = document.querySelector(".proposal-summary");
  if (summary && !elements.app.hidden) document.documentElement.style.setProperty("--proposal-summary-height", `${Math.ceil(summary.getBoundingClientRect().height)}px`);
}

function observeSummaryLayout() {
  const summary = document.querySelector(".proposal-summary");
  if (summary && typeof ResizeObserver !== "undefined") new ResizeObserver(updateSummaryHeight).observe(summary);
  else window.addEventListener("resize", updateSummaryHeight);
}

function observeSections() {
  const links = [...document.querySelectorAll(".anchor-sidebar a")];
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a,b) => b.intersectionRatio-a.intersectionRatio)[0];
    if (!visible) return;
    links.forEach(link => link.classList.toggle("active", link.hash === `#${visible.target.id}`));
  }, { rootMargin:"-30% 0px -55% 0px", threshold:[0,.2,.5] });
  document.querySelectorAll(".detail-section").forEach(section => observer.observe(section));
}

function resolveProposalId() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("id") || params.get("propostaId") || params.get("proposta");
  const fromHash = window.location.hash.startsWith("#proposta=") ? window.location.hash.slice(10) : "";
  const pathPart = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) || "");
  const fromPath = /^PROP[-_]/i.test(pathPart) ? pathPart : "";
  let fromSession = "";
  try { fromSession = sessionStorage.getItem("cityparkAdminProposalId") || ""; } catch { fromSession = ""; }
  return String(fromQuery || fromHash || fromPath || fromSession).trim();
}

function brokerData() { return { ...(state.broker || {}), ...(state.proposal?.corretorSnapshot || {}) }; }
function unitData() { return { ...(state.unit || {}), ...(state.proposal?.unidadeSnapshot || {}) }; }
function clientType(client = {}) {
  const type = normalizeStatus(client.tipoCliente);
  if (["pf", "fisica", "pessoa_fisica"].includes(type)) return "PF";
  if (["pj", "juridica", "pessoa_juridica"].includes(type)) return "PJ";
  if (client.cpf && !client.cnpj) return "PF";
  if (client.cnpj && !client.cpf) return "PJ";
  return "";
}
function clientName(client = {}) { return (clientType(client) === "PJ" ? client.razaoSocial || client.nomeCompleto : client.nomeCompleto || client.nome) || client.razaoSocial || "Não informado"; }
function clientFields(client = {}) {
  const type = clientType(client);
  const company = type === "PJ";
  return [
    [company ? "Razão social" : type === "PF" ? "Nome" : "Nome / Razão social", clientName(client)],
    ["Tipo", company ? "Pessoa jurídica (PJ)" : type === "PF" ? "Pessoa física (PF)" : "Não informado"],
    [company ? "CNPJ" : type === "PF" ? "CPF" : "CPF / CNPJ", formatCpfCnpj(company ? client.cnpj : type === "PF" ? client.cpf : client.cpf || client.cnpj)],
    [company ? "Telefone comercial" : "Telefone", formatPhone(company ? client.telefoneComercial || client.telefone : client.telefone || client.telefoneComercial)],
    [company ? "E-mail comercial" : "E-mail", company ? client.emailComercial || client.email : client.email || client.emailComercial]
  ];
}
function requireLinkedUnit() { if (!state.proposal?.unidadeId) throw new Error("Esta proposta não possui uma unidade vinculada."); }
function historyCommon(proposal, unit, from, to) { return { adminId:state.adminUser.uid, ano:new Date().getFullYear(), corretorId:proposal.corretorId || null, data:serverTimestamp(), propostaId:state.proposalId, statusAnterior:proposal.statusProposta || from, statusNovo:to, unidade:unit.unidade || proposal.unidadeSnapshot?.unidade || null, unidadeId:state.proposal.unidadeId }; }
function unitTableValue() { return moneyValue(unitData().valores || {}, ["precoAVistaCentavos","precoAVista","precoVistaCentavos","precoVista"]); }
function moneyValue(source, keys) { for (const key of keys) if (Number.isInteger(source?.[key])) return source[key]; return null; }
function percentageOfTable(total, table) { return PaymentPlan?.percentageOfTable ? PaymentPlan.percentageOfTable(total, table) : (Number(table) > 0 ? Math.round((Number(total || 0) / Number(table)) * 10000) / 100 : 0); }
function detail(label, value) { return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value === null || value === undefined || value === "" ? "Não informado" : value)}</dd></div>`; }
function conditionTypeLabel(value) { const status=normalizeStatus(value); return status === "padrao" ? "Condição padrão" : ["outro","personalizada","personalizado"].includes(status) ? "Condição personalizada" : "Condição não informada"; }
function periodicityLabel(value) { return { mensal:"Parcelas mensais", semestral:"Parcelas semestrais", anual:"Parcelas anuais", outra:"Negociação especial", unica:"Parcela única" }[value] || "Parcela"; }
function statusGroup(value) { const status=normalizeStatus(value); if (status === "reservada") return "pending"; if (status === "aprovada") return "approved"; if (status === "vendida") return "closed"; return "inactive"; }
function statusLabel(value) { const status=normalizeStatus(value); return { reservada:"Pendente para análise", aprovada:"Proposta aprovada", vendida:"Proposta encerrada", recusada:"Proposta recusada", cancelada:"Proposta cancelada", expirada:"Proposta expirada", distratada:"Proposta distratada", disponivel:"Disponível" }[status] || value || "Não informado"; }
function normalizeStatus(value) { return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"_"); }
function proposalExpiry(proposal, unit) {
  if (proposal.expiraEm !== undefined) return proposal.expiraEm;
  // Não reutilizar o prazo de outra reserva da mesma unidade.
  const linkedProposalId = unit?.propostaAtualId || unit?.propostaId;
  return proposal.id && linkedProposalId === proposal.id ? unit.expiraEm : null;
}
function expiryLabel(status, value, now = Date.now()) {
  if (!["reservada", "pendente"].includes(normalizeStatus(status))) return "Sem prazo de expiração ativo.";
  const date = toDate(value);
  if (!date) return "Expira em: prazo não informado.";
  const remaining = date.getTime() - now;
  if (remaining <= 0) return `Expirou em: ${formatDate(date)} — prazo encerrado.`;
  const minutes = Math.ceil(remaining / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const restMinutes = minutes % 60;
  const duration = days > 0 ? `${days} dia${days === 1 ? "" : "s"} e ${hours}h` : hours > 0 ? `${hours}h e ${restMinutes}min` : `${restMinutes}min`;
  return `Expira em: ${formatDate(date)} — restam ${duration}.`;
}
function formatMoney(value) { return Number.isInteger(value) ? (value/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}) : "—"; }
function formatPercentage(value) { return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits:0, maximumFractionDigits:2 })}%`; }
function formatDate(value) { const date=toDate(value); return date ? new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(date) : "Não informada"; }
function formatDateOnly(value) { const date=toDate(value); return date ? new Intl.DateTimeFormat("pt-BR",{dateStyle:"short"}).format(date) : "Não informada"; }
function dateInputValue(value) { const date=toDate(value); if (!date) return ""; const year=date.getFullYear(); const month=String(date.getMonth()+1).padStart(2,"0"); const day=String(date.getDate()).padStart(2,"0"); return `${year}-${month}-${day}`; }
function formatPhone(value) { const digits=String(value||"").replace(/\D/g,""); if (digits.length===11) return digits.replace(/(\d{2})(\d{5})(\d{4})/,"($1) $2-$3"); if (digits.length===10) return digits.replace(/(\d{2})(\d{4})(\d{4})/,"($1) $2-$3"); return value || "Não informado"; }
function formatCpfCnpj(value) { const digits=String(value||"").replace(/\D/g,""); if (digits.length===11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4"); if (digits.length===14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5"); return value || "Não informado"; }
function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    let date;
    if (typeof value.toDate === "function") date = value.toDate();
    else if (typeof value.seconds === "number" || typeof value._seconds === "number") date = new Date((value.seconds ?? value._seconds) * 1000 + (value.nanoseconds ?? value._nanoseconds ?? 0) / 1000000);
    else date = value instanceof Date ? value : new Date(value);
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  } catch { return null; }
}
function dateValue(value) { return toDate(value)?.getTime() || 0; }
function statusTransition(item) { return `${statusLabel(item.statusAnterior)} → ${statusLabel(item.statusNovo)}`; }
function escapeHtml(value) { return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
function showToast(message,isError=false) { clearTimeout(state.toastTimer); elements.toast.textContent=message; elements.toast.classList.toggle("error",isError); elements.toast.classList.add("visible"); state.toastTimer=setTimeout(()=>elements.toast.classList.remove("visible"),4200); }
