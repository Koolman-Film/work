/** Filesystem-safe zip entry name `<name>_<month>.pdf`, de-duped against `seen`. */
export function payslipZipEntryName(name: string, month: string, seen: Set<string>): string {
  const safe = name
    .trim()
    .replace(/[/\\]+/g, '-') // path separators
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control chars from filenames
    .replace(/[\x00-\x1f\x7f]+/g, '')
    .replace(/\s+/g, '_');
  const base = `${safe}_${month}`;
  let candidate = `${base}.pdf`;
  let n = 1;
  while (seen.has(candidate)) {
    n += 1;
    candidate = `${base} (${n}).pdf`;
  }
  seen.add(candidate);
  return candidate;
}
