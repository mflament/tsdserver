import fs from 'fs';
import { isArray, isString } from 'util';

export function fileExists(path: string): boolean {
  const stats = fileStats(path);
  return stats !== null && stats.isFile();
}

export function fileStats(path: string): fs.Stats | null {
  try {
    return fs.statSync(path, { bigint: false }) as fs.Stats;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return null;
  }
}

export function isStringArray(obj: any): obj is string[] {
  if (isArray(obj)) {
    return obj.every(e => isString(e));
  }
  return false;
}

export function replaceMatches(s: string, matches: RegExpMatchArray): string {
  let res = s;
  for (let index = 0; index < matches.length; index++) {
    res = s.replace('$' + index, matches[index]);
  }
  return res;
}
