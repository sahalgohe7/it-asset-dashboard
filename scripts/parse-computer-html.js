/**
 * Parses Computer.html (Google Sheets export) into structured JSON for the dashboard.
 * Run: node scripts/parse-computer-html.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const INPUT = path.join(ROOT, "Computer.html");
const OUTPUT = path.join(ROOT, "assets-data.json");
const OUTPUT_JS = path.join(ROOT, "data.js");

function decodeHtml(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function isBlank(value) {
  if (!value) return true;
  const v = value.trim();
  return v === "" || v === "\u200b" || v === "​";
}

function parseRows(html) {
  const rowMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const rows = [];
  let last = { officer: "", district: "", branch: "" };

  for (let i = 1; i < rowMatches.length; i++) {
    const cells = [
      ...rowMatches[i].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi),
    ].map((m) => decodeHtml(m[1]));

    if (cells.length < 12) continue;

    if (!isBlank(cells[0])) last.officer = cells[0];
    if (!isBlank(cells[1])) last.district = cells[1];
    if (!isBlank(cells[2])) last.branch = cells[2];

    const officer = isBlank(cells[0]) ? last.officer : cells[0];
    const district = isBlank(cells[1]) ? last.district : cells[1];
    const branch = isBlank(cells[2]) ? last.branch : cells[2];
    const deviceName = cells[3] || "";
    const printerModel = cells[11] || "";
    const hasComputer = !isBlank(deviceName);
    const hasPrinter = !isBlank(printerModel);

    if (!hasComputer && !hasPrinter) continue;
    if (isBlank(officer) && isBlank(district) && isBlank(branch)) continue;

    rows.push({
      officer,
      district,
      branch,
      deviceName,
      processor: cells[4] || "",
      ram: cells[5] || "",
      storage: cells[6] || "",
      os: cells[7] || "",
      computerConditionRaw: cells[8] || "",
      printerName: cells[10] || "",
      printerModel,
      printerConditionRaw: cells[12] || "",
      notes: cells[14] || "",
      hasComputer,
      hasPrinter,
    });
  }

  return rows;
}

function normalizeCondition(raw, assetKind = "computer") {
  const text = (raw || "").toLowerCase();

  if (isBlank(raw)) return "Fair";

  if (
    /ma shaqayn|not work|broken|damaged|dead|waxba ma soo saaro/i.test(text) ||
    text.includes("cilad ayaa haysata")
  ) {
    return "Damaged";
  }

  if (
    /hagaajin|baadho|culays|xunyahy|xun yahay|jaam|problem|poor|fault/i.test(
      text
    ) ||
    text.includes("uu xunyahy") ||
    text.includes("culays ayaa ku jira")
  ) {
    return "Poor";
  }

  if (
    /fcn ayu ushaq|fcn ayuu ushaq|works fine|good|weeye/i.test(text) ||
    text.includes("si fcn")
  ) {
    return "Good";
  }

  if (assetKind === "printer" && isBlank(raw)) return "Fair";

  return "Fair";
}

function classifyDevice(deviceName) {
  const d = (deviceName || "").toLowerCase();
  if (d.includes("laptop")) return "laptop";
  if (
    d.includes("desktop") ||
    d.includes("all in one") ||
    d.includes("lenovo") ||
    d.includes("cononeo") ||
    d.includes("hp") ||
    d.includes("computer") ||
    d.includes("pc")
  ) {
    return "computer";
  }
  if (!isBlank(deviceName)) return "computer";
  return "other";
}

function normalizeProcessor(raw) {
  const p = (raw || "").toLowerCase();
  if (isBlank(raw)) return "Other";
  if (p.includes("i7")) return "Core i7";
  if (p.includes("i5") || p.includes("i 5")) return "Core i5";
  if (p.includes("i3") || p.includes("i 3") || p.includes("i4")) return "Core i3";
  if (p.includes("ryzen")) return "Ryzen";
  if (p.includes("pentium") || p.includes("dual core") || p.includes("xeon")) {
    return "Other";
  }
  return "Other";
}

function normalizeRam(raw) {
  const r = (raw || "").toLowerCase().replace(/\s/g, "");
  if (isBlank(raw)) return "Other";
  if (r.includes("32")) return "32GB";
  if (r.includes("16")) return "16GB";
  if (r.includes("8")) return "8GB";
  if (r.includes("4")) return "4GB";
  return "Other";
}

function normalizeOs(raw) {
  const o = (raw || "").toLowerCase();
  if (isBlank(raw)) return "Other";
  if (o.includes("11")) return "Windows 11";
  if (o.includes("10") || o.includes("windowa")) return "Windows 10";
  if (o.includes("8")) return "Windows 8";
  if (o.includes("7")) return "Other";
  if (o.includes("linux") || o.includes("ubuntu")) return "Linux";
  return "Other";
}

function normalizeStorage(raw) {
  const s = (raw || "").toLowerCase().replace(/\s/g, "");
  if (isBlank(raw)) return "Other";
  if (/1tb|1024|1000/.test(s)) return "1TB";
  if (/512/.test(s)) return "512GB";
  if (/256/.test(s)) return "256GB";
  if (/128/.test(s)) return "128GB";
  return "Other";
}

function enrichRow(row) {
  const deviceType = classifyDevice(row.deviceName);
  const computerCondition = normalizeCondition(row.computerConditionRaw, "computer");
  const printerCondition = normalizeCondition(row.printerConditionRaw, "printer");

  return {
    ...row,
    deviceType,
    computerCondition,
    printerCondition,
    processorCategory: normalizeProcessor(row.processor),
    ramCategory: normalizeRam(row.ram),
    osCategory: normalizeOs(row.os),
    storageCategory: normalizeStorage(row.storage),
  };
}

function main() {
  const html = fs.readFileSync(INPUT, "utf8");
  const rawRows = parseRows(html);
  const rows = rawRows.map(enrichRow);

  const computers = rows.filter((r) => r.hasComputer && r.deviceType === "computer");
  const laptops = rows.filter((r) => r.hasComputer && r.deviceType === "laptop");
  const printers = rows.filter((r) => r.hasPrinter);

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFile: "Computer.html",
    summary: {
      totalAssets: computers.length + laptops.length + printers.length,
      totalComputers: computers.length,
      totalLaptops: laptops.length,
      totalPrinters: printers.length,
    },
    rows,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(
    OUTPUT_JS,
    `window.ASSET_DATA = ${JSON.stringify(payload)};\n`,
    "utf8"
  );
  console.log(`Wrote ${rows.length} records to ${OUTPUT}`);
  console.log(`Wrote ${OUTPUT_JS} for offline dashboard loading`);
  console.log("Summary:", payload.summary);
}

main();
