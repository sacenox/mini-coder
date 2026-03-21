import pkg from "../../package.json";

declare const __PACKAGE_VERSION__: string;

/** Package version — resolved at build time, falls back to package.json in dev. */
export const PACKAGE_VERSION: string =
  typeof __PACKAGE_VERSION__ !== "undefined"
    ? __PACKAGE_VERSION__
    : pkg.version;
