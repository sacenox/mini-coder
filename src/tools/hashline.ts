const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashLine(content: string): string {
	let hash = FNV_OFFSET_BASIS;
	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = (hash * FNV_PRIME) >>> 0;
	}
	return (hash & 0xff).toString(16).padStart(2, "0");
}

export function formatHashLine(lineNum: number, content: string): string {
	return `${lineNum}:${hashLine(content)}| ${content}`;
}
