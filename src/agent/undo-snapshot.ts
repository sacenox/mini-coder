import type { CoreMessage } from "../llm-api/turn.ts";
import { deleteLastTurn } from "../session/db/index.ts";
import type { ActiveSession } from "../session/manager.ts";
import {
	type SnapshotRestoreResult,
	restoreSnapshot,
} from "../tools/snapshot.ts";
import type { AgentReporter } from "./reporter.ts";

export interface UndoContext {
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

	// Find the message index where the last turn starts (last user message)
	let lastUserIdx = -1;
	for (let i = session.messages.length - 1; i >= 0; i--) {
		if (session.messages[i]?.role === "user") {
			lastUserIdx = i;
			break;
		}
	}
	if (lastUserIdx === -1) return false;

	// Trim in-memory DB history
	session.messages.splice(lastUserIdx);

	// Trim coreHistory to match — find last user message in coreHistory
	let coreLastUserIdx = -1;
	for (let i = coreHistory.length - 1; i >= 0; i--) {
		if (coreHistory[i]?.role === "user") {
			coreLastUserIdx = i;
			break;
		}
	}
	if (coreLastUserIdx !== -1) coreHistory.splice(coreLastUserIdx);

	// Delete from DB and decrement turn counter
	const deleted = deleteLastTurn(session.id);
	const poppedTurn = snapshotStack.pop() ?? null;
	if (turnIndex > 0) ctx.setTurnIndex(turnIndex - 1);

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
