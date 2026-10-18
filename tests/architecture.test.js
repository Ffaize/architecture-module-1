import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// these tests fail when modules start using each other's data or internals

const srcDir = new URL("../src/", import.meta.url);

// which database tables each module is allowed to use
const tablesByModule = {
  checkout: [],
  orders: ["orders"],
  inventory: ["products", "inventoryOperations"],
  payments: ["payments"],
  notifications: ["notifications", "emailQueue"],
  reporting: []
};
const sharedDbMethods = ["nextId"];

// leaks we already have. Remove a line when the leak is fixed,
// the test will fail until you do. Never add new lines here.
const knownLeaks = [
  "orders -> products", // orders take prices from the inventory table
  "reporting -> notifications",
  "reporting -> orders",
  "reporting -> payments",
  "reporting -> products"
];

function readSourceFiles() {
  return readdirSync(srcDir, { recursive: true })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".js"))
    .map((path) => ({ path, code: readFileSync(new URL(path, srcDir), "utf8") }));
}

// "payments/PaymentService.js" -> "payments", "app.js" -> null
function getModuleName(path) {
  const parts = path.split("/");
  return parts.length > 1 ? parts[0] : null;
}

test("modules use only their own tables, apart from known leaks", () => {
  const leaks = new Set();

  for (const { path, code } of readSourceFiles()) {
    const moduleName = getModuleName(path);
    if (!(moduleName in tablesByModule)) continue;

    for (const [, table] of code.matchAll(/this\.database\.(\w+)/g)) {
      const allowed = tablesByModule[moduleName].includes(table) || sharedDbMethods.includes(table);
      if (!allowed) leaks.add(`${moduleName} -> ${table}`);
    }
  }

  assert.deepEqual([...leaks].sort(), [...knownLeaks].sort());
});

test("modules do not import other modules directly", () => {
  for (const { path, code } of readSourceFiles()) {
    const moduleName = getModuleName(path);
    if (!moduleName || moduleName === "shared") continue;

    for (const [, imported] of code.matchAll(/from\s+"\.\.\/([^/"]+)\//g)) {
      assert.equal(imported, "shared", `${path} imports ../${imported}/`);
    }
  }
});

test("payment provider and orders repository stay inside their modules", () => {
  for (const { path, code } of readSourceFiles()) {
    if (path === "app.js") continue; // app.js wires everything together, that's its job
    const moduleName = getModuleName(path);

    if (moduleName !== "payments") {
      assert.doesNotMatch(code, /PaymentProvider/, `${path} uses a payment provider directly`);
    }
    if (moduleName !== "orders") {
      assert.doesNotMatch(code, /orderRepository/i, `${path} uses the orders repository`);
    }
  }
});
