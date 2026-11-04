// Spike 2: create a clan as a Sputnik DAO v2 through the testnet factory, and find the
// smallest deposit that works. A failed create refunds the deposit (factory callback).
import { loadAccount, firstKeyId, viewAccount, yocto, near } from "./lib.mjs";

const FACTORY = "sputnikv2.testnet";
const me = loadAccount(firstKeyId());
const name = process.argv[2] || `clan-${Date.now().toString(36)}`;
const daoId = `${name}.${FACTORY}`;

const args = Buffer.from(
  JSON.stringify({
    config: { name, purpose: "AD FONTES test clan", metadata: "" },
    policy: [me.accountId],
  }),
).toString("base64");

for (const dep of [0.1, 0.5, 1, 3, 6]) {
  const before = (await viewAccount(me.accountId)).amount;
  let ok = false;
  try {
    const r = await me.callFunctionRaw({
      contractId: FACTORY,
      methodName: "create",
      args: { name, args },
      deposit: yocto(dep),
      gas: "150000000000000",
    });
    const fails = r.receipts_outcome.filter((o) => o.outcome.status.Failure);
    ok = !!(await viewAccount(daoId)) && fails.length === 0;
    if (fails.length) console.log(`deposit ${dep}: receipt failure`, JSON.stringify(fails[0].outcome.status.Failure).slice(0, 220));
  } catch (e) {
    console.log(`deposit ${dep}: error`, String(e.message || e).slice(0, 220));
  }
  await new Promise((r) => setTimeout(r, 2500));
  const after = (await viewAccount(me.accountId)).amount;
  console.log(`deposit ${dep} NEAR -> ${ok ? "CREATED" : "not created"}; caller spent ${near(BigInt(before) - BigInt(after))} NEAR`);
  if (ok) break;
}

const dao = await viewAccount(daoId);
if (dao) {
  console.log(daoId, "holds", near(dao.amount), "NEAR, storage", dao.storage_usage, "bytes, code", dao.code_hash, dao.global_contract_hash || "");
  const pol = await me.provider.callFunction(daoId, "get_policy", {});
  console.log("council:", JSON.stringify(pol.roles.find((r) => r.name === "council")?.kind));
}
