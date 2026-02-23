import pkg from "../package.json";

const result = await Bun.build({
	entrypoints: ["src/index.ts"],
	target: "bun",
	outdir: "dist",
	naming: "mc.js",
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
