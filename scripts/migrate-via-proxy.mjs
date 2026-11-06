// Wraps migrate-state.mjs with a temporary TCP proxy host/port (args: host port net).
const [host, port, net = "testnet"] = process.argv.slice(2);
const u = new URL(process.env.DATABASE_URL);
u.hostname = host; u.port = port;
process.env.DATABASE_PUBLIC_URL = u.toString();
process.argv = [process.argv[0], "migrate-state.mjs", net];
await import("./migrate-state.mjs");
