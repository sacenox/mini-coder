import { homedir } from "node:os";
import { join } from "node:path";

export const DATA_DIR = join(homedir(), ".config", "mini-coder");
export const AUTH_PATH = join(DATA_DIR, "auth.json");
export const SETTINGS_PATH = join(DATA_DIR, "settings.json");

export function secureRandomString(
  length: number,
  chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
): string {
  const result: string[] = [];
  const charsLength = chars.length;
  const maxValid = Math.floor(256 / charsLength) * charsLength;
  const randomBytes = new Uint8Array(length * 2);

  while (result.length < length) {
    crypto.getRandomValues(randomBytes);

    for (const byte of randomBytes) {
      if (byte < maxValid) {
        result.push(chars[byte % charsLength]);
        if (result.length === length) break;
      }
    }
  }

  return result.join("");
}

export function elapsedTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;

  const years = Math.floor(days / 365);
  return `${years}y`;
}

export function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  return elapsedTime(seconds);
}

export function onceEvery<T extends unknown[]>(
  n: number,
  fn: (...args: T) => void,
) {
  let calls = 0;

  return (...args: T) => {
    calls++;

    if (calls % n === 0) {
      fn(...args);
    }
  };
}

export function takeTail<T>(arr: T[], x: number): T[] {
  return x <= 0 ? [] : arr.slice(-x);
}
