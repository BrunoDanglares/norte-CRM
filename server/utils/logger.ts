const DEBUG = process.env.ISP_DEBUG === 'true' || process.env.NODE_ENV === 'development';

export function debug(tag: string, message: string) {
  if (DEBUG) console.log(`[${tag}] ${message}`);
}

export function info(tag: string, message: string) {
  console.log(`[${tag}] ${message}`);
}

export function warn(tag: string, message: string) {
  console.warn(`[${tag}] ${message}`);
}

export function error(tag: string, message: string, err?: unknown) {
  if (err instanceof Error) {
    console.error(`[${tag}] ${message}: ${err.message}`);
  } else {
    console.error(`[${tag}] ${message}`);
  }
}
