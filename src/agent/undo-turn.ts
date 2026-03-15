import type { CoreMessage } from "../llm-api/turn.ts";
import {
	deleteLastTurn,
	getMaxTurnIndex,
	loadMessages,
} from "../session/db/index.ts";
import type { ActiveSession } from "../session/manager.ts";

interface UndoContext {
	session: ActiveSession;
	coreHistory: CoreMessage[];
	setTurnIndex: (idx: number) => void;
}

export async function undoLastTurn(ctx: UndoContext): Promise<boolean> {
	const { session, coreHistory } = ctx;

	if (session.messages.length === 0) return false;

	const deleted = deleteLastTurn(session.id);
	if (!deleted) return false;

	const remaining = loadMessages(session.id);
	session.messages.length = 0;
	session.messages.push(...remaining);

	coreHistory.length = 0;
	coreHistory.push(...remaining);

	ctx.setTurnIndex(getMaxTurnIndex(session.id) + 1);
	return true;
}
