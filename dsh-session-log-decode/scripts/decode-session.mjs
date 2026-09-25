#!/usr/bin/env node
// Decode a DSH session log. The artifact is a concatenation of independent
// Zstandard frames (RFC 8878): one frame per durable batch, the first frame
// holding the session header line. Calling zstdDecompressSync on the whole
// file yields only the first frame, so this tool scans frame boundaries and
// decompresses every complete frame separately.
//
// Generations: version 0 is session.jsonl[.zstd]; every later Session format
// generation adds a lowercase numeric component, e.g. session.v4.jsonl.zstd.
// One session directory may hold several generations after a migration, so a
// directory argument resolves to the newest generation.
//
// Usage:
//   node decode-session.mjs <session-dir|log-file> [out.jsonl] [options]
//     --text           readable transcript (user/assistant text + tool names)
//     --full           transcript with tool arguments and truncated results
//     --last N         keep only the last N event records (header kept)
//     --grep REGEX     keep only records whose raw JSON matches REGEX
//     --version, -V    print the tool version
//     --help, -h       print usage
//
// The summary and any warnings go to stderr; records go to stdout unless an
// output path is given. Exit codes: 0 ok, 1 read/decode failure, 2 bad usage.
// A torn trailing frame is a warning, not an error. No dependencies beyond
// node:zlib (Node 22+ / 24).
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

/** Tool version: bump when the CLI contract or the frame scanner changes. */
const VERSION = "1.1.0";
const MAGIC = 0xfd2fb528;
const LF = String.fromCharCode(10);

/** Scan complete Zstandard frames; report a torn trailing frame as an offset. */
function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== MAGIC) throw new Error("invalid Zstandard frame magic at byte " + offset);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error("reserved frame-header bit at byte " + (offset - 1));
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < headerBytes) return { frames, tornStart: start };
    offset += headerBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const type = (blockHeader >> 1) & 3;
      const size = blockHeader >>> 3;
      if (type === 3) throw new Error("reserved block type at byte " + (offset - 3));
      const payloadBytes = type === 1 ? 1 : size;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if ((blockHeader & 1) !== 0) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

/** Read the format generation from a canonical log basename, else undefined. */
function logGeneration(name) {
  const base = name.endsWith(".zstd") ? name.slice(0, -5) : name;
  if (!base.endsWith(".jsonl")) return undefined;
  const stem = base.slice(0, -6);
  if (stem === "session") return 0;
  if (!stem.startsWith("session.v")) return undefined;
  const digits = stem.slice(9);
  if (!/^[1-9][0-9]*$/.test(digits)) return undefined;
  return Number(digits);
}

/** Resolve a session directory to its newest canonical log generation. */
function resolveLog(input) {
  if (!statSync(input).isDirectory()) return input;
  const found = [];
  for (const name of readdirSync(input)) {
    const generation = logGeneration(name);
    if (generation !== undefined) found.push({ name, generation });
  }
  if (found.length === 0) throw new Error("no session[.vN].jsonl[.zstd] under " + input);
  found.sort((a, b) => b.generation - a.generation);
  for (const older of found.slice(1)) process.stderr.write("note: older generation also present: " + older.name + LF);
  process.stderr.write("generation: " + found[0].name + LF);
  return join(input, found[0].name);
}

/** A usage error exits with 2; every other failure exits with 1. */
function usageError(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

/** One-line JSON of a value, clamped so a single tool call cannot flood the view. */
function clampJson(value, limit) {
  let text;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  if (text === undefined) return "";
  return text.length > limit ? text.slice(0, limit) + " ...(+" + (text.length - limit) + " chars)" : text;
}

/** Text blocks of a tool result, clamped to keep one line readable. */
function resultText(data, limit) {
  const content = data?.content;
  if (!Array.isArray(content)) return "";
  const joined = content.filter((part) => typeof part?.text === "string").map((part) => part.text).join(LF);
  return joined.length > limit ? joined.slice(0, limit) + " ...(+" + (joined.length - limit) + " chars)" : joined;
}

const isToolCallType = (type) => type === "tool/call" || type === "tool/ptc-dispatch-start" || type === "tool/ptc-dispatch";

/** Render the event records as a readable transcript (optionally with tool detail). */
function transcript(records, full) {
  // An inner call is persisted twice ("-start" plus its result record); render
  // only the result-bearing one so --full shows each dispatch once.
  const completed = new Set();
  for (const line of records) {
    try {
      const record = JSON.parse(line);
      if (record.type === "tool/ptc-dispatch" && typeof record.data?.subCallId === "string") completed.add(record.data.subCallId);
    } catch { /* unparsable lines are skipped below as well */ }
  }
  const out = [];
  for (const line of records) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const type = record.type;
    if (type === "tool/ptc-dispatch-start" && completed.has(record.data?.subCallId)) continue;
    if (isToolCallType(type)) {
      const label = type === "tool/call" ? "[tool/call]" : "[tool/call/inner]";
      const name = typeof record.data?.name === "string" ? record.data.name : "tool";
      const detail = full ? clampJson(record.data?.arguments, 400) : "";
      out.push(label + " " + name + (detail === "" ? "" : " " + detail));
      continue;
    }
    if (full && type === "tool/result") {
      const text = resultText(record.data?.message?.content ?? record.data?.content, 300);
      if (text.length > 0) out.push("[tool/result] " + text);
      continue;
    }
    if (type !== "user/message" && type !== "assistant/message") continue;
    const content = type === "user/message" ? record.data.content : record.data.message.content;
    const text = (content ?? []).filter((part) => part.type === "text").map((part) => part.text).join(LF);
    if (text.length > 0) out.push("##### " + type + " #" + record.seq + LF + text);
  }
  return out.join(LF + LF) + LF;
}

const USAGE = [
  "usage: node decode-session.mjs <session-dir|log-file> [out.jsonl] [options]",
  "  --text            readable transcript (default output is JSONL)",
  "  --full            transcript including tool arguments and tool results",
  "  --last N          keep only the last N event records (the header survives)",
  "  --grep REGEX      keep only records whose raw JSON matches REGEX",
  "  --version, -V     print the tool version and exit",
  "  --help, -h        print this help and exit"
].join(LF);

/** Parse argv. Usage errors carry `usage: true` so main can exit with 2. */
function parseArgs(argv) {
  const options = { input: undefined, outPath: undefined, mode: "jsonl", last: undefined, grep: undefined, version: false, help: false };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--text" || arg === "--full") { options.mode = arg.slice(2); continue; }
    if (arg === "--version" || arg === "-V") { options.version = true; continue; }
    if (arg === "--help" || arg === "-h") { options.help = true; continue; }
    if (arg === "--last") {
      const raw = argv[index + 1];
      const count = Number(raw);
      if (raw === undefined || !Number.isInteger(count) || count < 1) throw usageError("--last needs a positive integer");
      options.last = count;
      index += 1;
      continue;
    }
    if (arg === "--grep") {
      const raw = argv[index + 1];
      if (raw === undefined || raw === "") throw usageError("--grep needs a pattern");
      try { options.grep = new RegExp(raw); } catch (error) { throw usageError("--grep is not a valid regex: " + error.message); }
      index += 1;
      continue;
    }
    if (arg.length > 1 && arg.startsWith("-")) throw usageError("unknown option: " + arg);
    positional.push(arg);
  }
  if (positional.length > 2) throw usageError("too many positional arguments");
  options.input = positional[0];
  options.outPath = positional[1];
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(USAGE + LF); return; }
  if (options.version) { process.stdout.write("decode-session.mjs " + VERSION + LF); return; }
  if (options.input === undefined) { process.stderr.write(USAGE + LF); process.exit(2); }
  try {
    if (!statSync(options.input).isDirectory() && statSync(options.input).isFile() === false) throw new Error("not a file or directory");
  } catch {
    throw new Error("input not found: " + options.input);
  }
  const source = resolveLog(options.input);
  const bytes = readFileSync(source);
  let plaintext;
  let frameCount = 0;
  let tornStart;
  if (source.endsWith(".zstd")) {
    const scan = scanFrames(bytes);
    frameCount = scan.frames.length;
    tornStart = scan.tornStart;
    const chunks = scan.frames.map((frame) => zstdDecompressSync(bytes.subarray(frame.start, frame.end)));
    plaintext = Buffer.concat(chunks).toString("utf8");
  } else {
    plaintext = bytes.toString("utf8");
  }
  const all = plaintext.split(LF).filter((line) => line.length > 0);
  let header = {};
  try { header = JSON.parse(all[0] ?? "{}"); } catch { header = {}; }
  let records = all.slice(1);
  const totalEvents = records.length;
  if (options.grep !== undefined) records = records.filter((line) => options.grep.test(line));
  if (options.last !== undefined) records = records.slice(-options.last);
  // The JSONL export keeps the header line, so decoding a filtered log still
  // yields a readable artifact (one header + the selected records).
  const outputLines = all.length > 0 ? [all[0]].concat(records) : records;
  const counts = new Map();
  for (const line of records) {
    let type = "unparsable";
    try { type = JSON.parse(line).type; } catch { type = "unparsable"; }
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const histogram = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((entry) => entry[0] + "=" + entry[1]).join(" ");
  const created = header.createdAt === undefined ? "?" : new Date(header.createdAt).toISOString();
  const torn = tornStart === undefined ? "" : "  [torn tail from byte " + tornStart + " ignored]";
  const shape = source.endsWith(".zstd") ? "frames: " + frameCount : "compression: none";
  const filtered = options.grep !== undefined || options.last !== undefined;
  process.stderr.write("decode-session.mjs v" + VERSION + LF);
  process.stderr.write("source: " + source + LF);
  process.stderr.write(shape + "  bytes: " + bytes.length + "  events: " + totalEvents + torn + LF);
  if (filtered) process.stderr.write("selected: " + records.length + " of " + totalEvents + " events" + LF);
  process.stderr.write("header: formatVersion=" + header.version + " id=" + header.id + " createdAt=" + created + " cwd=" + header.cwd + LF);
  process.stderr.write("events: " + histogram + LF);
  if (options.mode === "text" || options.mode === "full") {
    process.stdout.write(transcript(records, options.mode === "full"));
  } else if (options.outPath !== undefined) {
    writeFileSync(options.outPath, outputLines.join(LF) + LF);
    process.stderr.write("wrote " + options.outPath + LF);
  } else {
    process.stdout.write(outputLines.join(LF) + LF);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write("error: " + error.message + LF);
  process.exit(error?.usage === true ? 2 : 1);
}
