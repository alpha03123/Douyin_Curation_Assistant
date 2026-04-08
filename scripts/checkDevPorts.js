const net = require("node:net");

const mode = process.argv[2] || "dev";

const modePorts = {
  dev: [
    { port: 3001, label: "后端端口 3001" },
    { port: 5173, label: "前端端口 5173" },
  ],
  "client-only": [{ port: 5173, label: "前端端口 5173" }],
  "server-only": [{ port: 3001, label: "后端端口 3001" }],
};

function checkHostPort(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const cleanup = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(600);
    socket.once("connect", () => cleanup(true));
    socket.once("timeout", () => cleanup(false));
    socket.once("error", () => cleanup(false));
  });
}

async function isPortInUse(port) {
  const hosts = ["127.0.0.1", "localhost", "::1"];
  for (const host of hosts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const inUse = await checkHostPort(host, port);
      if (inUse) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

function printHelp(conflicts) {
  console.error("[ports] 检测到以下端口已经被占用：");
  for (const item of conflicts) {
    console.error(`- ${item.label}`);
  }

  console.error(
    "[ports] 先停止旧的开发进程，再重试。Windows 下可执行 `./stop_dev.ps1`。"
  );
}

async function main() {
  const targets = modePorts[mode];
  if (!targets) {
    console.error(`[ports] Unsupported mode: ${mode}`);
    process.exit(1);
  }

  const conflicts = [];
  for (const item of targets) {
    // eslint-disable-next-line no-await-in-loop
    const inUse = await isPortInUse(item.port);
    if (inUse) {
      conflicts.push(item);
    }
  }

  if (conflicts.length > 0) {
    printHelp(conflicts);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[ports] preflight check failed", error);
  process.exit(1);
});
