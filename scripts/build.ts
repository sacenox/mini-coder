import pkg from "../package.json";

async function buildEntrypoint(entrypoint: string, outputName: string) {
	const result = await Bun.build({
		entrypoints: [entrypoint],
		target: "bun",
		outdir: "dist",
		naming: outputName,
		packages: "external",
		define: {
			__PACKAGE_VERSION__: JSON.stringify(pkg.version),
		},
	});

	if (!result.success) {
		for (const log of result.logs) {
			console.error(log);
		}
		process.exit(1);
	}
}

await buildEntrypoint("src/index.ts", "mc.js");
await buildEntrypoint("src/mc-edit.ts", "mc-edit.js");
