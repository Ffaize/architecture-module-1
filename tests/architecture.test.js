import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Architecture fitness functions: they fail the build when module boundaries get worse.

const srcDir = new URL("../src/", import.meta.url);

const DATA_OWNERS = {
  checkout: [],
  orders: ["orders"],
  inventory: ["products", "inventoryOperations"],
  payments: ["payments"],
  notifications: ["notifications", "notificationJobs"],
  reporting: []
};
const SHARED_DATABASE_API = ["nextId"];

// Leaks that already exist today. This list may only shrink:
// when a leak is fixed, the test fails until the line is removed here.
const KNOWN_DATA_LEAKS = [
  "orders -> products", // Orders calculates prices from Inventory data
  "reporting -> notifications",
  "reporting -> orders",
  "reporting -> payments",
  "reporting -> products"
];

function sourceFiles() {
  return readdirSync(srcDir, { recursive: true })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".js"))
    .map((path) => ({ path, text: readFileSync(new URL(path, srcDir), "utf8") }));
}

function moduleOf(path) {
  const [first, ...rest] = path.split("/");
  return rest.length > 0 ? first : null;
}

test("modules use only their own data, apart from known leaks", () => {
  const leaks = new Set();
  for (const { path, text } of sourceFiles()) {
    const owner = moduleOf(path);
    if (!(owner in DATA_OWNERS)) continue;
    for (const [, collection] of text.matchAll(/this\.database\.(\w+)/g)) {
      const allowed = DATA_OWNERS[owner].includes(collection) || SHARED_DATABASE_API.includes(collection);
      if (!allowed) leaks.add(`${owner} -> ${collection}`);
    }
  }

  assert.deepEqual([...leaks].sort(), [...KNOWN_DATA_LEAKS].sort());
});

test("modules do not import other modules directly", () => {
  for (const { path, text } of sourceFiles()) {
    const owner = moduleOf(path);
    if (!owner || owner === "shared") continue;
    for (const [, target] of text.matchAll(/from\s+"\.\.\/([^/"]+)\//g)) {
      assert.equal(target, "shared", `${path} imports ../${target}/`);
    }
  }
});

test("payment provider and Orders repository stay behind their modules", () => {
  for (const { path, text } of sourceFiles()) {
    if (path === "app.js") continue; // composition root wires everything together
    const owner = moduleOf(path);
    if (owner !== "payments") {
      assert.doesNotMatch(text, /PaymentProvider/, `${path} uses a payment provider directly`);
    }
    if (owner !== "orders") {
      assert.doesNotMatch(text, /orderRepository|OrderRepository/i, `${path} uses the Orders repository`);
    }
  }
});
