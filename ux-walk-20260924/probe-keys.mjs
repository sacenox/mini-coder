process.stdin.setRawMode(true);
process.stdout.write("\x1b[>1u\x1b[?u");
process.stdin.on("data", (d) => process.stdout.write(JSON.stringify(d.toString()) + "\r\n"));
