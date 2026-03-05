export interface Logger {
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export function createLogger(verbose = false): Logger {
  const stamp = () => new Date().toISOString();

  return {
    debug: (msg) => {
      if (verbose) {
        console.log(`${stamp()} [DEBUG] ${msg}`);
      }
    },
    info: (msg) => console.log(`${stamp()} [INFO] ${msg}`),
    warn: (msg) => console.warn(`${stamp()} [WARN] ${msg}`),
    error: (msg) => console.error(`${stamp()} [ERROR] ${msg}`)
  };
}
