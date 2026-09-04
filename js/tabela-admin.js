import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";
import { collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";

const $ = id => document.getElementById(id);
const elements = {
  filter: $("typologyFilter"),
  loading: $("unitLoading"),
  content: $("unitContent"),
  empty: $("unitEmpty"),
  towerA: $("towerAUnits"),
  towerB: $("towerBUnits"),
  toast: $("adminToast"),
  totalCount: $("totalUnitCount"),
  visibleLabel: $("visibleUnitLabel"),
  updatedAt: $("unitLastUpdated"),
  availableCount: $("availableCount"),
  availablePercentage: $("availablePercentage"),
  reservedCount: $("reservedCount"),
  reservedPercentage: $("reservedPercentage"),
  soldCount: $("soldCount"),
  soldPercentage: $("soldPercentage")
};
const state = { units: [], toastTimer: null };

onAuthStateChanged(auth, async user => {
  if (!user) return location.replace("vendas.html");
  try {
    const adminSnapshot = await getDoc(doc(db, "admins", user.uid));
    const admin = adminSnapshot.exists() ? adminSnapshot.data() : null;
    if (!admin || admin.ativo !== true || admin.tipo !== "admin") {
      window.alert("Acesso restrito a administradores ativos.");
      return location.replace("vendas.html");
    }
    document.documentElement.classList.add("page-authorized");
    elements.filter.addEventListener("change", render);
    await loadUnits();
  } catch (error) {
    console.error("[tabela-admin] inicialização:", error);
    document.documentElement.classList.add("page-authorized");
    elements.loading.textContent = "Não foi possível carregar as unidades.";
    showToast(error.message || "Falha ao carregar unidades.", true);
  }
});

async function loadUnits() {
  const snapshot = await getDocs(collection(db, "unidades"));
  state.units = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  elements.updatedAt.textContent = `Atualizado em: ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`;
  render();
}

function render() {
  const selected = elements.filter.value;
  const visible = state.units.filter(unit => selected === "all" || typologyKey(unit.tipologia) === selected);
  renderSummary(visible);
  const towerA = visible.filter(unit => unitTower(unit) === "A").sort(sortUnits);
  const towerB = visible.filter(unit => unitTower(unit) === "B").sort(sortUnits);
  elements.towerA.innerHTML = towerA.map(renderUnit).join("");
  elements.towerB.innerHTML = towerB.map(renderUnit).join("");
  elements.loading.hidden = true;
  elements.empty.hidden = visible.length > 0;
  elements.content.hidden = visible.length === 0;
}

function renderSummary(units) {
  const counts = { available: 0, reserved: 0, sold: 0 };
  units.forEach(unit => {
    const group = statusGroup(unit.status);
    if (group in counts) counts[group] += 1;
  });
  const total = units.length;
  elements.totalCount.textContent = String(total);
  elements.visibleLabel.textContent = total === 1 ? "unidade" : "unidades";
  for (const key of Object.keys(counts)) {
    elements[`${key}Count`].textContent = String(counts[key]);
    elements[`${key}Percentage`].textContent = total ? `${((counts[key] / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% do total` : "0% do total";
  }
}

function renderUnit(unit) {
  const label = unit.unidade || unit.numero || unit.id;
  const group = statusGroup(unit.status);
  const status = statusLabel(unit.status);
  return `<article class="unit-card" data-status="${group}" title="${escapeHtml(status)}" aria-label="Unidade ${escapeHtml(label)}, ${escapeHtml(status)}">${escapeHtml(label)}</article>`;
}

function typologyKey(value) {
  const text = normalize(value).replace(/\s+/g, " ");
  if (text.includes("3 quarto")) return "3-quartos";
  if (text.includes("2 quarto")) return "2-quartos";
  if (text.includes("studio")) return "studio";
  if (text.includes("quarto/sala") || text.includes("quarto e sala") || text.includes("quarto sala")) return "quarto-sala";
  if (text.includes("loft")) return "loft";
  return text.replace(/\s+/g, "-");
}
function statusGroup(value) {
  const text = normalize(value);
  if (text.includes("vend")) return "sold";
  if (text.includes("reserv") || text.includes("aprov")) return "reserved";
  if (text.includes("dispon")) return "available";
  return "unknown";
}
function statusLabel(value) { return { available: "Disponível", reserved: "Reservada", sold: "Vendida", unknown: "Status não informado" }[statusGroup(value)]; }
function unitTower(unit) {
  const text = String(unit.torre || unit.bloco || unit.unidade || unit.numero || unit.id).trim().toUpperCase();
  if (/TORRE\s*B/.test(text) || /(?:^|[^A-Z])B(?:[^A-Z]|$)/.test(text) || /\dB$/.test(text)) return "B";
  return "A";
}
function unitNumber(unit) { return Number(String(unit.unidade || unit.numero || unit.id).match(/\d+/)?.[0] || 0); }
function sortUnits(a, b) { return unitNumber(a) - unitNumber(b) || String(a.unidade || a.id).localeCompare(String(b.unidade || b.id), "pt-BR", { numeric: true }); }
function normalize(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 4200);
}
