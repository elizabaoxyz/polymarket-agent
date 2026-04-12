/**
 * Structured logger — zero-dep wrapper over console with timestamps and levels.
 * Use for startup, server, and plugin logging. The autonomy core uses callbacks.log() instead.
 */

function fmt(level: string, prefix: string, msg: string): string {
  return `${new Date().toISOString()} [${level}] [${prefix}] ${msg}`;
}

export const log = {
  info(prefix: string, msg: string): void {
    console.log(fmt("INFO", prefix, msg));
  },
  warn(prefix: string, msg: string): void {
    console.warn(fmt("WARN", prefix, msg));
  },
  error(prefix: string, msg: string): void {
    console.error(fmt("ERROR", prefix, msg));
  },
};
