import * as c from "yoctocolors";
import {
	getAccessToken,
	getOAuthProvider,
	getOAuthProviders,
	isLoggedIn,
	listLoggedInProviders,
	login,
	logout,
} from "../session/oauth/auth-storage.ts";
import { PREFIX, writeln } from "./output.ts";
import type { CommandContext } from "./types.ts";

function renderLoginHelp(): void {
	writeln();
	writeln(`  ${c.dim("usage:")}`);
	writeln(`    /login                 ${c.dim("show login status")}`);
	writeln(`    /login <provider>      ${c.dim("login via OAuth")}`);
	writeln(`    /logout <provider>     ${c.dim("clear saved tokens")}`);
	writeln();
	writeln(`  ${c.dim("providers:")}`);
	for (const p of getOAuthProviders()) {
		const status = isLoggedIn(p.id)
			? c.green("logged in")
			: c.dim("not logged in");
		writeln(`    ${c.cyan(p.id.padEnd(20))} ${p.name} ${c.dim("·")} ${status}`);
	}
	writeln();
}

function renderStatus(): void {
	const loggedIn = listLoggedInProviders();
	if (loggedIn.length === 0) {
		writeln(
			`${PREFIX.info} ${c.dim("no OAuth logins — use")} /login <provider>`,
		);
		return;
	}
	for (const id of loggedIn) {
		const provider = getOAuthProvider(id);
		const name = provider?.name ?? id;
		writeln(`${PREFIX.success} ${c.cyan(id)} ${c.dim(name)}`);
	}
}

export async function handleLoginCommand(
	ctx: CommandContext,
	args: string,
): Promise<void> {
	const providerId = args.trim().toLowerCase();

	if (!providerId) {
		renderStatus();
		return;
	}

	if (providerId === "help" || providerId === "--help") {
		renderLoginHelp();
		return;
	}

	const provider = getOAuthProvider(providerId);
	if (!provider) {
		writeln(
			`${PREFIX.error} unknown provider "${providerId}" — available: ${getOAuthProviders()
				.map((p) => p.id)
				.join(", ")}`,
		);
		return;
	}

	if (isLoggedIn(providerId)) {
		// Verify the token is still refreshable
		const token = await getAccessToken(providerId);
		if (token) {
			writeln(
				`${PREFIX.success} already logged in to ${c.cyan(provider.name)}`,
			);
			return;
		}
		// Token expired and couldn't refresh — proceed with fresh login
	}

	ctx.startSpinner("waiting for browser login");
	try {
		await login(providerId, {
			onOpenUrl: (url, instructions) => {
				ctx.stopSpinner();
				writeln(`${PREFIX.info} ${instructions}`);
				writeln();
				writeln(`  ${c.cyan(url)}`);
				writeln();
				// Try to open the browser
				let open = "xdg-open";
				if (process.platform === "darwin") open = "open";
				else if (process.platform === "win32") open = "start";
				Bun.spawn([open, url], { stdout: "ignore", stderr: "ignore" });
				ctx.startSpinner("waiting for browser callback");
			},
			onProgress: (msg) => {
				ctx.stopSpinner();
				writeln(`${PREFIX.info} ${c.dim(msg)}`);
				ctx.startSpinner("exchanging tokens");
			},
		});
		ctx.stopSpinner();
		writeln(`${PREFIX.success} logged in to ${c.cyan(provider.name)}`);
	} catch (err) {
		ctx.stopSpinner();
		writeln(`${PREFIX.error} login failed: ${(err as Error).message}`);
	}
}

export function handleLogoutCommand(_ctx: CommandContext, args: string): void {
	const providerId = args.trim().toLowerCase();

	if (!providerId) {
		writeln(`${PREFIX.error} usage: /logout <provider>`);
		return;
	}

	if (!isLoggedIn(providerId)) {
		writeln(`${PREFIX.info} ${c.dim("not logged in to")} ${providerId}`);
		return;
	}

	logout(providerId);
	writeln(`${PREFIX.success} logged out of ${c.cyan(providerId)}`);
}
