import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";
import { collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";

const $ = id => document.getElementById(id);
const elements = {
  adminName: $("adminName"),
  pendingProposalCount: $("pendingProposalCount"),
  logout: $("btnSairAdmin"),
  toast: $("adminToast"),
  updatedAt: $("lastUpdatedAt"),
  totalUnits: $("totalUnitCount"),
  availableUnits: $("availableUnitCount"),
  availableRate: $("availableUnitRate"),
  reservedUnits: $("reservedUnitCount"),
  soldUnits: $("soldUnitCount"),
  donut: $("inventoryDonut"),
  availableLegend: $("availableLegend"),
  reservedLegend: $("reservedLegend"),
  soldLegend: $("soldLegend"),
  recentList: $("recentProposalList")
};

let toastTimer;

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace("vendas.html");
    return;
  }
  try {
    const adminSnapshot = await getDoc(doc(db, "admins", user.uid));
    const admin = adminSnapshot.exists() ? adminSnapshot.data() : null;
    if (!admin || admin.ativo !== true || admin.tipo !== "admin") {
      window.alert("Acesso restrito a administradores ativos.");
      window.location.replace("vendas.html");
      return;
    }
    const adminLabel = admin.nome || user.displayName || user.email || "administrador";
    elements.adminName.textContent = firstName(adminLabel);
    document.documentElement.classList.add("page-authorized");
    await loadDashboard();
  } catch (error) {
    console.error("[ambiente-admin] inicialização:", error);
    window.alert("Não foi possível validar o acesso administrativo. Tente novamente.");
    window.location.replace("vendas.html");
  }
});

elements.logout?.addEventListener("click", async () => {
  elements.logout.disabled = true;
  try {
    await signOut(auth);
    window.location.replace("vendas.html");
  } catch (error) {
    console.error("[ambiente-admin] logout:", error);
    elements.logout.disabled = false;
    showToast("Não foi possível sair agora. Tente novamente.", true);
  }
});

async function loadDashboard() {
  try {
    const [proposalSnapshot, unitSnapshot] = await Promise.all([
      getDocs(collection(db, "propostas")),
      getDocs(collection(db, "unidades"))
    ]);
    const proposals = proposalSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const units = unitSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderMetrics(proposals, units);
    renderRecentProposals(proposals);
    elements.updatedAt.textContent = `Atualizado em: ${new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date())}`;
  } catch (error) {
    console.error("[ambiente-admin] dashboard:", error);
    elements.recentList.innerHTML = '<div class="recent-empty">Não foi possível carregar as movimentações agora.</div>';
    showToast("Não foi possível atualizar o resumo do ambiente.", true);
  }
}

function renderMetrics(proposals, units) {
  const counts = { available: 0, reserved: 0, sold: 0 };
  units.forEach(unit => {
    const group = unitStatusGroup(unit.status);
    if (group in counts) counts[group] += 1;
  });
  const total = units.length;
  const pending = proposals.filter(proposal => proposalStatusGroup(proposal.statusProposta) === "pending").length;
  const availablePercentage = total ? (counts.available / total) * 100 : 0;
  const reservedPercentage = total ? (counts.reserved / total) * 100 : 0;

  elements.totalUnits.textContent = String(total);
  elements.availableUnits.textContent = String(counts.available);
  elements.availableRate.textContent = `${formatPercentage(availablePercentage)} do empreendimento`;
  elements.reservedUnits.textContent = String(counts.reserved);
  elements.soldUnits.textContent = String(counts.sold);
  elements.pendingProposalCount.textContent = String(pending);
  elements.availableLegend.textContent = `${counts.available} unidade${counts.available === 1 ? "" : "s"}`;
  elements.reservedLegend.textContent = `${counts.reserved} unidade${counts.reserved === 1 ? "" : "s"}`;
  elements.soldLegend.textContent = `${counts.sold} unidade${counts.sold === 1 ? "" : "s"}`;
  elements.donut.style.setProperty("--available", String(availablePercentage));
  elements.donut.style.setProperty("--reserved", String(reservedPercentage));
}

function renderRecentProposals(proposals) {
  const recent = [...proposals].sort((a, b) => dateValue(b.criadoEm) - dateValue(a.criadoEm)).slice(0, 4);
  if (!recent.length) {
    elements.recentList.innerHTML = '<div class="recent-empty">Nenhuma proposta foi registrada até o momento.</div>';
    return;
  }
  elements.recentList.innerHTML = recent.map(proposal => {
    const unit = proposal.unidadeSnapshot?.unidade || proposal.unidadeId || "Unidade não informada";
    const client = proposal.cliente?.nomeCompleto || proposal.cliente?.razaoSocial || "Cliente não informado";
    const group = proposalStatusGroup(proposal.statusProposta);
    return `<a class="recent-item" href="detalhes-proposta.html?id=${encodeURIComponent(proposal.id)}">
      <span data-status="${group}">${escapeHtml(proposalStatusLabel(proposal.statusProposta))}</span>
      <strong>Unidade ${escapeHtml(unit)}</strong>
      <small>${escapeHtml(client)} · ${escapeHtml(formatDate(proposal.criadoEm))}</small>
    </a>`;
  }).join("");
}

function unitStatusGroup(value) {
  const status = normalize(value);
  if (status.includes("vend")) return "sold";
  if (status.includes("reserv") || status.includes("aprov")) return "reserved";
  if (status.includes("dispon")) return "available";
  return "unknown";
}
function proposalStatusGroup(value) {
  const status = normalize(value).replace(/\s+/g, "_");
  if (["reservada", "pendente", "em_analise"].includes(status)) return "pending";
  if (["aprovada", "aprovado"].includes(status)) return "approved";
  if (["vendida", "vendido", "encerrada", "encerrado"].includes(status)) return "closed";
  return "inactive";
}
function proposalStatusLabel(value) { return { pending: "Em análise", approved: "Aprovada", closed: "Encerrada", inactive: "Inativa" }[proposalStatusGroup(value)]; }
function firstName(value) { return String(value || "administrador").trim().split(/\s+/)[0]; }
function normalize(value) { return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function toDate(value) { if (!value) return null; if (typeof value.toDate === "function") return value.toDate(); if (value instanceof Date) return value; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function dateValue(value) { return toDate(value)?.getTime() || 0; }
function formatDate(value) { const date = toDate(value); return date ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date) : "data não informada"; }
function formatPercentage(value) { return `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`; }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 4200);
}
