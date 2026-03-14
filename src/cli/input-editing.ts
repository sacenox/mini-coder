export function insertAtCursor(
	buf: string,
	cursor: number,
	text: string,
): { buf: string; cursor: number } {
	return {
		buf: buf.slice(0, cursor) + text + buf.slice(cursor),
		cursor: cursor + text.length,
	};
}

export function moveCursorWordLeft(buf: string, cursor: number): number {
	let next = cursor;
	while (next > 0 && buf[next - 1] === " ") next--;
	while (next > 0 && buf[next - 1] !== " ") next--;
	return next;
}

export function moveCursorWordRight(buf: string, cursor: number): number {
	let next = cursor;
	while (next < buf.length && buf[next] === " ") next++;
	while (next < buf.length && buf[next] !== " ") next++;
	return next;
}

export function deleteWordBackward(
	buf: string,
	cursor: number,
): { buf: string; cursor: number } {
	const nextCursor = moveCursorWordLeft(buf, cursor);
	return {
		buf: buf.slice(0, nextCursor) + buf.slice(cursor),
		cursor: nextCursor,
	};
}
