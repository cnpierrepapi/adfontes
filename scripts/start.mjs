// Production web server (Railway): serves the built site on $PORT.
import { spawn } from "node:child_process";
const port = process.env.PORT || "3000";
const p = spawn(process.execPath, ["node_modules/serve/build/main.js", "dist", "-l", `tcp://0.0.0.0:${port}`], { stdio: "inherit" });
p.on("exit", (code) => process.exit(code ?? 0));
