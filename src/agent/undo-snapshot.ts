import type { CoreMessage } from "../llm-api/turn.ts";
import { deleteLastTurn, loadMessages } from "../session/db/index.ts";
import type { ActiveSession } from "../session/manager.ts";
import {
	restoreSnapshot,
	type SnapshotRestoreResult,
} from "../tools/snapshot.ts";
import type { AgentReporter } from "./reporter.ts";

interface UndoContext {
	session: ActiveSession;
	coreHistory: CoreMessage[];
	snapshotStack: Array<number | null>;
	getTurnIndex: () => number;
	setTurnIndex: (idx: number) => void;
	cwd: string;
	reporter: AgentReporter;
}

export async function undoLastTurn(ctx: UndoContext): Promise<boolean> {
	const { session, coreHistory, snapshotStack, cwd, reporter } = ctx;
	const turnIndex = ctx.getTurnIndex();

	// Nothing to undo if there are no messages
	if (session.messages.length === 0) return false;

	// Delete from DB and decrement turn counter
	const deleted = deleteLastTurn(session.id);
	if (!deleted) return false;

	const poppedTurn = snapshotStack.pop() ?? null;
	if (turnIndex > 0) ctx.setTurnIndex(turnIndex - 1);

	// Sync in-memory history reliably with DB state
	const remaining = loadMessages(session.id);
	session.messages.length = 0;
	session.messages.push(...remaining);

	coreHistory.length = 0;
	coreHistory.push(...remaining);

	// Restore files from the SQLite snapshot for the turn being undone
	if (poppedTurn !== null) {
		const restoreResult: SnapshotRestoreResult = await restoreSnapshot(
			cwd,
			session.id,
			poppedTurn,
		);
		if (restoreResult.restored === false && restoreResult.reason === "error") {
			reporter.error(
				"snapshot restore failed — some files may not have been reverted",
			);
		}
	}

	return deleted;
}
