import "server-only";
import { execFile, type ExecFileOptions } from "node:child_process";

export function runImportProcess(binary: string, args: string[], options: ExecFileOptions): Promise<string> {
  // Hosting wrappers can drop execFile's custom promisify symbol. Use its callback contract.
  return new Promise((resolve, reject) => {
    execFile(binary, args, { ...options, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
