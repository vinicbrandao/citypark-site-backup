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
  summary: document.querySelector(".proposal-summary"), proposalId: $("summaryProposalId"), createdAt: $("summaryCreatedAt"), unit: $("summaryUnit"), broker: $("summaryBroker"), creci: $("summaryCreci"), client: $("summaryClient"), clientDocument: $("summaryDocument"),
  actions: $("proposalActions"), approve: $("approveProposal"), reject: $("rejectProposal"), status: $("proposalStatus"), expiry: $("expiryText"), tags: $("reservationTags"),
  brokerTab: $("brokerTab"), clientTab: $("clientTab"), brokerPanel: $("brokerPanel"), clientPanel: $("clientPanel"), brokerInformation: $("brokerInformation"), clientInformation: $("clientInformation"),
  financeType: $("financeConditionType"), financeValidation: $("financeValidation"), tableValue: $("financeTableValue"), proposalValue: $("financeProposalValue"), difference: $("financeDifference"), differenceCard: $("financeDifferenceCard"), financeRows: $("financeRows"),
  history: $("historyTimeline"), cancellationSection: $("cancelamento"), cancelApproved: $("cancelApprovedProposal"), confirmationModal: $("confirmationModal"), confirmationIcon: $("confirmationIcon"), confirmationTitle: $("confirmationTitle"), confirmationText: $("confirmationText"), reasonField: $("rejectionReasonField"), reasonLabel: $("actionReasonLabel"), reason: $("rejectionReason"), reasonError: $("rejectionReasonError"), confirmAction: $("confirmAction"),
  financeModal: $("financeModal"), financeForm: $("financeEditForm"), editDescription: $("editDescription"), editQuantity: $("editQuantity"), editValue: $("editValue"), editDueDate: $("editDueDate"), editError: $("editFinanceError"), saveFinance: $("saveFinance"), toast: $("toast")
};

const state = {
  adminUser: null, admin: null, proposalId: resolveProposalId(), proposal: null, unit: null, broker: null,
  financeComponents: [], modalAction: null, editingKey: null, initialized: false, toastTimer: null
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
  elements.cancelApproved.addEventListener("click", () => openConfirmation("cancel"));
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
}

function renderAll() {
  renderSummary();
  renderReservation();
  renderGeneralData();
  renderFinance();
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
  elements.clientDocument.textContent = `CPF/CNPJ: ${formatCpfCnpj(client.cpf || client.cnpj)}`;
}

function renderReservation() {
  const status = normalizeStatus(state.proposal.statusProposta);
  const group = statusGroup(status);
  elements.status.textContent = statusLabel(status);
  elements.status.dataset.group = group;
  elements.summary.dataset.statusGroup = group;
  elements.actions.hidden = status !== "reservada";
  elements.cancellationSection.hidden = status !== "aprovada";
  elements.expiry.textContent = expiryLabel(status, state.proposal.expiraEm);
  const stages = ["Análise comercial", "Validação de documentos", "Aguardando assinatura", "Envio Sienge", "Contraproposta", "Vendida"];
  const approved = ["aprovada", "vendida"].includes(status);
  elements.tags.innerHTML = stages.map((label, index) => {
    const className = index === 0 ? (status === "reservada" ? "pending" : approved ? "complete" : "locked") : approved ? "" : "locked";
    return `<span class="process-tag ${className}">${escapeHtml(label)}</span>`;
  }).join("");
}

function renderGeneralData() {
  const broker = brokerData();
  const client = state.proposal.cliente || {};
  elements.brokerInformation.innerHTML = [
    detail("Nome", broker.nome), detail("CPF", formatCpfCnpj(broker.cpf)), detail("CRECI", broker.creci), detail("Telefone", formatPhone(broker.telefone)), detail("E-mail", broker.email), detail("Imobiliária", broker.imobiliaria || broker.razaoSocial), detail("Criado em", formatDate(broker.criadoEm))
  ].join("");
  elements.clientInformation.innerHTML = [
    detail("Tipo", client.tipoCliente), detail("Nome / Razão social", clientName(client)), detail("CPF / CNPJ", formatCpfCnpj(client.cpf || client.cnpj)), detail("Telefone", formatPhone(client.telefone || client.telefoneComercial)), detail("E-mail", client.email || client.emailComercial)
  ].join("");
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
  elements.tableValue.textContent = formatMoney(tableValue);
  elements.proposalValue.textContent = formatMoney(calculated);
  elements.difference.textContent = formatMoney(difference);
  elements.differenceCard.classList.toggle("unbalanced", !balanced);
  const customCondition = ["outro", "personalizada", "personalizado"].includes(normalizeStatus(condition.tipo));
  elements.financeType.textContent = customCondition ? "Outro" : "Padrão";
  elements.financeValidation.textContent = balanced ? "Valores conferidos" : "Revisão necessária";
  elements.financeValidation.classList.toggle("invalid", !balanced);
  elements.financeRows.innerHTML = rows.length
    ? renderFinanceTableRows(rows, condition.schemaVersao >= 3)
    : `<tr><td class="empty-table" colspan="5">A condição financeira desta proposta não possui dados estruturados.</td></tr>`;
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
    return `<tr>${groupCell}<td>${escapeHtml(row.quantidade || "—")}</td><td>${formatMoney(row.valorUnitarioCentavos)}</td><td>${escapeHtml(formatDateOnly(row.primeiroVencimento))}</td><td><button class="edit-finance-button" type="button" data-edit-component="${escapeHtml(row.key || "")}" ${canEdit ? "" : "disabled title=\"Edição disponível apenas para propostas na estrutura atual\""} aria-label="Editar ${escapeHtml(row.label)}">✎</button></td></tr>`;
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
  const configurations = {
    approve: { icon:"✓", tone:"success", title:"Aprovar esta proposta?", text:"A proposta será aprovada e o temporizador de expiração será removido.", confirm:"Sim, aprovar proposta", requiresReason:false },
    reject: { icon:"!", tone:"danger", title:"Recusar esta proposta?", text:"A proposta ficará inativa e a unidade voltará a ficar disponível.", confirm:"Confirmar recusa", reasonLabel:"Motivo da recusa", reasonError:"Informe o motivo da recusa.", requiresReason:true },
    cancel: { icon:"!", tone:"danger", title:"Cancelar esta proposta aprovada?", text:"A proposta ficará cancelada, a unidade voltará a ficar disponível e a ação será registrada no histórico.", confirm:"Confirmar cancelamento", reasonLabel:"Motivo do cancelamento", reasonError:"Informe o motivo do cancelamento.", requiresReason:true }
  };
  const configuration = configurations[action];
  if (!configuration) return;
  elements.confirmationIcon.textContent = configuration.icon;
  elements.confirmationIcon.className = `modal-icon ${configuration.tone}`;
  elements.confirmationTitle.textContent = configuration.title;
  elements.confirmationText.textContent = configuration.text;
  elements.confirmAction.textContent = configuration.confirm;
  elements.confirmAction.className = configuration.requiresReason ? "danger-button" : "primary-button";
  elements.reasonField.hidden = !configuration.requiresReason;
  elements.reasonLabel.textContent = configuration.reasonLabel || "Motivo";
  elements.reasonError.textContent = configuration.reasonError || "Informe o motivo desta ação.";
  elements.reason.value = "";
  elements.reasonError.hidden = true;
  elements.confirmationModal.hidden = false;
  document.body.classList.add("modal-open");
  (configuration.requiresReason ? elements.reason : elements.confirmAction).focus();
}

function closeConfirmation() {
  if (elements.confirmAction.disabled) return;
  elements.confirmationModal.hidden = true;
  document.body.classList.remove("modal-open");
  state.modalAction = null;
}

async function executeConfirmedAction() {
  const reason = elements.reason.value.trim();
  if (["reject", "cancel"].includes(state.modalAction) && !reason) {
    elements.reasonError.hidden = false;
    elements.reason.focus();
    return;
  }
  elements.confirmAction.disabled = true;
  try {
    const action = state.modalAction;
    if (action === "approve") await approveProposal();
    else if (action === "reject") await rejectProposal(reason);
    else if (action === "cancel") await cancelApprovedProposal(reason);
    elements.confirmationModal.hidden = true;
    document.body.classList.remove("modal-open");
    const messages = { approve:"Proposta aprovada e expiração removida.", reject:"Proposta recusada e unidade liberada.", cancel:"Proposta cancelada e unidade liberada." };
    showToast(messages[action] || "Ação concluída.");
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

async function cancelApprovedProposal(reason) {
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
    const linkedProposalId = unit.propostaAtualId || unit.propostaId || null;
    if (normalizeStatus(proposal.statusProposta) !== "aprovada" || normalizeStatus(unit.status) !== "aprovada" || (linkedProposalId && linkedProposalId !== state.proposalId)) {
      throw new Error("Esta proposta não pode mais ser cancelada. Atualize a página.");
    }
    const common = historyCommon(proposal, unit, "aprovada", "cancelada");
    transaction.update(proposalRef, { statusProposta:"cancelada", adminId:state.adminUser.uid, observacaoAdmin:reason, observacaoCancelamento:reason, tagsAdmin:[], atualizadoEm:serverTimestamp(), expiraEm:null, vendidoEm:null });
    transaction.update(unitRef, { status:"disponivel", propostaAtualId:null, propostaId:deleteField(), atualizadoEm:serverTimestamp(), expiraEm:null, vendidoEm:null });
    transaction.set(unitHistoryRef, { ...common, statusNovo:"disponivel", acao:"unidade disponível", observacao:"Unidade liberada após o cancelamento da proposta aprovada." });
    transaction.set(proposalHistoryRef, { ...common, acao:"proposta cancelada", observacao:reason });
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
    const condition = { ...current, componentes, descricao:descriptionText, totalCalculadoCentavos:total, diferencaCentavos:Number.isInteger(table) ? table-total : null };
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
function clientName(client = {}) { return client.nomeCompleto || client.razaoSocial || client.nome || "Não informado"; }
function requireLinkedUnit() { if (!state.proposal?.unidadeId) throw new Error("Esta proposta não possui uma unidade vinculada."); }
function historyCommon(proposal, unit, from, to) { return { adminId:state.adminUser.uid, ano:new Date().getFullYear(), corretorId:proposal.corretorId || null, data:serverTimestamp(), propostaId:state.proposalId, statusAnterior:proposal.statusProposta || from, statusNovo:to, unidade:unit.unidade || proposal.unidadeSnapshot?.unidade || null, unidadeId:state.proposal.unidadeId }; }
function unitTableValue() { return moneyValue(unitData().valores || {}, ["precoAVistaCentavos","precoAVista","precoVistaCentavos","precoVista"]); }
function moneyValue(source, keys) { for (const key of keys) if (Number.isInteger(source?.[key])) return source[key]; return null; }
function detail(label, value) { return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value === null || value === undefined || value === "" ? "Não informado" : value)}</dd></div>`; }
function conditionTypeLabel(value) { const status=normalizeStatus(value); return status === "padrao" ? "Condição padrão" : ["outro","personalizada","personalizado"].includes(status) ? "Condição personalizada" : "Condição não informada"; }
function periodicityLabel(value) { return { mensal:"Parcelas mensais", semestral:"Parcelas semestrais", anual:"Parcelas anuais", outra:"Negociação especial", unica:"Parcela única" }[value] || "Parcela"; }
function statusGroup(value) { const status=normalizeStatus(value); if (status === "reservada") return "pending"; if (status === "aprovada") return "approved"; if (status === "vendida") return "closed"; return "inactive"; }
function statusLabel(value) { const status=normalizeStatus(value); return { reservada:"Pendente para análise", aprovada:"Proposta aprovada", vendida:"Proposta encerrada", recusada:"Proposta recusada", cancelada:"Proposta cancelada", expirada:"Proposta expirada", distratada:"Proposta distratada", disponivel:"Disponível" }[status] || value || "Não informado"; }
function normalizeStatus(value) { return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"_"); }
function expiryLabel(status, value) { if (status !== "reservada" || !value) return "Sem temporizador de expiração ativo."; const date=toDate(value); if (!date) return "Prazo de expiração não informado."; const days=Math.max(0,Math.ceil((date-Date.now())/86400000)); return days === 0 ? "Expira hoje." : `Expira em ${days} dia${days===1?"":"s"}.`; }
function formatMoney(value) { return Number.isInteger(value) ? (value/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}) : "—"; }
function formatDate(value) { const date=toDate(value); return date ? new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(date) : "Não informada"; }
function formatDateOnly(value) { const date=toDate(value); return date ? new Intl.DateTimeFormat("pt-BR",{dateStyle:"short"}).format(date) : "Não informada"; }
function dateInputValue(value) { const date=toDate(value); if (!date) return ""; const year=date.getFullYear(); const month=String(date.getMonth()+1).padStart(2,"0"); const day=String(date.getDate()).padStart(2,"0"); return `${year}-${month}-${day}`; }
function formatPhone(value) { const digits=String(value||"").replace(/\D/g,""); if (digits.length===11) return digits.replace(/(\d{2})(\d{5})(\d{4})/,"($1) $2-$3"); if (digits.length===10) return digits.replace(/(\d{2})(\d{4})(\d{4})/,"($1) $2-$3"); return value || "Não informado"; }
function formatCpfCnpj(value) { const digits=String(value||"").replace(/\D/g,""); if (digits.length===11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4"); if (digits.length===14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5"); return value || "Não informado"; }
function toDate(value) { if (!value) return null; if (typeof value.toDate === "function") return value.toDate(); if (value instanceof Date) return value; const date=new Date(value); return Number.isNaN(date.getTime())?null:date; }
function dateValue(value) { return toDate(value)?.getTime() || 0; }
function statusTransition(item) { return `${statusLabel(item.statusAnterior)} → ${statusLabel(item.statusNovo)}`; }
function escapeHtml(value) { return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
function showToast(message,isError=false) { clearTimeout(state.toastTimer); elements.toast.textContent=message; elements.toast.classList.toggle("error",isError); elements.toast.classList.add("visible"); state.toastTimer=setTimeout(()=>elements.toast.classList.remove("visible"),4200); }
