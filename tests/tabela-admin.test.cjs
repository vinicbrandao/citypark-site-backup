const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function tableLogic() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { classList: { add() {}, remove() {}, toggle() {} } });
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: node, documentElement: { classList: { add() {} } } },
    window: { alert() {} }, location: { replace() {} }, auth: {}, db: {}, console,
    onAuthStateChanged() {}, Intl, Date, setTimeout, clearTimeout
  });
  const source = fs.readFileSync(path.join(__dirname, "../js/tabela-admin.js"), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  vm.runInContext(source, context);
  return vm.runInContext("({ sortUnits, unitNumber, unitTower, renderUnit })", context);
}

test("ordena as unidades do menor número para o maior em cada torre", () => {
  const { sortUnits } = tableLogic();
  const units = ["1204 A", "101 A", "904 A", "203 A", "1102 A", "203 B"]
    .map((unidade, index) => ({ id:`unit-${index}`, unidade }));
  units.sort(sortUnits);
  assert.deepEqual(units.map(unit => unit.unidade), ["101 A", "203 A", "203 B", "904 A", "1102 A", "1204 A"]);
});

test("desempata unidades do mesmo número em ordem natural", () => {
  const { sortUnits } = tableLogic();
  const units = [{ unidade:"804 B", id:"b" }, { unidade:"804 A", id:"a" }].sort(sortUnits);
  assert.deepEqual(units.map(unit => unit.unidade), ["804 A", "804 B"]);
});
