function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function normalizeMaterial(material) {
  const value = normalizeText(material);

  if (value.includes("6061") || value.includes("7075") || value.includes("alum")) {
    return "aluminum";
  }
  if (value.includes("stainless") || value.includes("304") || value.includes("316")) {
    return "stainless steel";
  }
  if (value.includes("tool steel") || value.includes("steel") || value.includes("4140") || value.includes("1018")) {
    return "steel";
  }
  if (value.includes("brass")) {
    return "brass";
  }
  if (value.includes("copper")) {
    return "copper";
  }
  if (value.includes("titanium") || value.includes("ti-6")) {
    return "titanium";
  }
  if (value.includes("delrin") || value.includes("acetal")) {
    return "delrin";
  }
  if (value.includes("abs")) {
    return "abs";
  }
  if (
    value.includes("plastic") ||
    value.includes("nylon") ||
    value.includes("peek") ||
    value.includes("uhmw") ||
    value.includes("poly")
  ) {
    return "plastic";
  }

  return value || "unknown";
}

function getMaterialProfile(material) {
  const normalized = normalizeMaterial(material);
  const profiles = {
    aluminum: { factor: 1.04, setup: 0.95 },
    steel: { factor: 1.28, setup: 1.08 },
    "stainless steel": { factor: 1.48, setup: 1.14 },
    brass: { factor: 1.22, setup: 1.02 },
    copper: { factor: 1.36, setup: 1.08 },
    titanium: { factor: 2.05, setup: 1.2 },
    plastic: { factor: 0.84, setup: 0.9 },
    delrin: { factor: 0.86, setup: 0.9 },
    abs: { factor: 0.8, setup: 0.88 },
    unknown: { factor: 1.16, setup: 1 }
  };

  return {
    normalized,
    ...(profiles[normalized] || profiles.unknown)
  };
}

function normalizeMachineType(machineType) {
  const value = normalizeText(machineType);

  if (value.includes("5-axis") || value.includes("5 axis")) {
    return "5-axis mill";
  }
  if (value.includes("4-axis") || value.includes("4 axis")) {
    return "4-axis mill";
  }
  if (value.includes("3-axis") || value.includes("3 axis") || value.includes("mill")) {
    return "3-axis mill";
  }
  if (value.includes("lathe") || value.includes("turn")) {
    return "lathe";
  }
  if (value.includes("edm")) {
    return "edm";
  }
  if (value.includes("waterjet")) {
    return "waterjet";
  }
  if (value.includes("laser")) {
    return "laser";
  }

  return value || "general machining";
}

function getMachineProfile(machineType, fileName, notes) {
  const raw = normalizeMachineType(machineType);
  const combined = `${normalizeText(fileName)} ${normalizeText(notes)}`;
  let normalized = raw;

  if (raw === "general machining") {
    if (combined.includes("shaft") || combined.includes("turn") || combined.includes("threaded rod")) {
      normalized = "lathe";
    } else if (combined.includes("plate") || combined.includes("bracket") || combined.includes("pocket")) {
      normalized = "3-axis mill";
    }
  }

  const profiles = {
    "3-axis mill": { factor: 1, setup: 1 },
    "4-axis mill": { factor: 1.14, setup: 1.1 },
    "5-axis mill": { factor: 1.34, setup: 1.2 },
    lathe: { factor: 0.96, setup: 0.94 },
    edm: { factor: 1.42, setup: 1.18 },
    waterjet: { factor: 0.68, setup: 0.74 },
    laser: { factor: 0.7, setup: 0.72 },
    "general machining": { factor: 1.06, setup: 1.02 }
  };

  return {
    normalized,
    ...(profiles[normalized] || profiles["general machining"])
  };
}

function parseNotesFlags(notes, fileName) {
  const text = `${normalizeText(notes)} ${normalizeText(fileName)}`;

  return {
    hasTightTolerance: /tight|precision|\.000|0\.00|tol|tolerance/.test(text),
    hasThreads: /thread|tap|tapped|helicoil/.test(text),
    hasFinish: /anod|coat|plating|passivat|polish|bead blast|finish/.test(text),
    hasInspection: /inspection|qc|cmm|first article|fai/.test(text),
    hasWeldment: /weld|fabricat|assembly/.test(text),
    rush: /rush|expedite|urgent|same day/.test(text),
    thinWall: /thin wall|thin-wall/.test(text)
  };
}

function getComplexityFactor(fileKb, fileName, notes) {
  const flags = parseNotesFlags(notes, fileName);
  let factor = 1 + Math.log10(Math.max(10, fileKb)) * 0.52;

  if (/housing|manifold|impeller|fixture|mold/.test(normalizeText(fileName))) factor += 0.18;
  if (flags.hasTightTolerance) factor += 0.16;
  if (flags.hasThreads) factor += 0.08;
  if (flags.hasFinish) factor += 0.06;
  if (flags.hasInspection) factor += 0.07;
  if (flags.hasWeldment) factor += 0.1;
  if (flags.thinWall) factor += 0.12;

  return clamp(factor, 0.95, 3.4);
}

function getQuantityDiscount(quantity) {
  if (quantity >= 250) return 0.64;
  if (quantity >= 100) return 0.72;
  if (quantity >= 50) return 0.79;
  if (quantity >= 25) return 0.85;
  if (quantity >= 10) return 0.91;
  if (quantity >= 5) return 0.96;
  return 1;
}

function buildHeuristicEstimate(input) {
  const qty = Math.max(1, Number(input.quantity) || 1);
  const fileKb = Math.max(1, Number(input.stpFileSizeKb) || 1);
  const material = getMaterialProfile(input.material);
  const machine = getMachineProfile(input.machineType, input.stpFileName, input.notes);
  const complexity = getComplexityFactor(fileKb, input.stpFileName, input.notes);
  const flags = parseNotesFlags(input.notes, input.stpFileName);

  let setupCost = 95 * material.setup * machine.setup;
  if (flags.hasInspection) setupCost += 35;
  if (flags.rush) setupCost += 55;

  let unitCost = 28 * material.factor * machine.factor * complexity;
  if (flags.hasFinish) unitCost += 7;
  if (flags.hasThreads) unitCost += 4;
  if (flags.hasTightTolerance) unitCost *= 1.12;
  if (flags.rush) unitCost *= 1.18;

  const quantityDiscount = getQuantityDiscount(qty);
  const discountedUnit = unitCost * quantityDiscount;
  const total = setupCost + discountedUnit * qty;

  return {
    total,
    unitPrice: discountedUnit,
    quantityDiscount,
    material,
    machine,
    complexity,
    flags
  };
}

function buildComparable(trainingRecord) {
  const qty = Math.max(1, Number(trainingRecord.quantity) || 1);
  const actualPrice = Math.max(0, Number(trainingRecord.actualPrice) || 0);
  const fileKb = Math.max(1, Number(trainingRecord.stpFile?.sizeKb) || 1);
  const material = getMaterialProfile(trainingRecord.material);
  const machine = getMachineProfile(trainingRecord.machineType, trainingRecord.stpFile?.originalName, trainingRecord.notes);
  const complexity = getComplexityFactor(fileKb, trainingRecord.stpFile?.originalName, trainingRecord.notes);

  return {
    id: trainingRecord.id,
    qty,
    actualPrice,
    fileKb,
    material,
    machine,
    complexity,
    machineType: trainingRecord.machineType || "",
    notes: trainingRecord.notes || "",
    unitPrice: qty ? actualPrice / qty : actualPrice,
    originalName: trainingRecord.stpFile?.originalName || ""
  };
}

function scoreComparable(input, record) {
  let score = 1;

  if (input.material.normalized === record.material.normalized) {
    score += 2.4;
  } else if (
    ["plastic", "delrin", "abs"].includes(input.material.normalized) &&
    ["plastic", "delrin", "abs"].includes(record.material.normalized)
  ) {
    score += 1.3;
  }

  if (input.machine.normalized === record.machine.normalized) {
    score += 1.4;
  }

  const qtyDistance = Math.abs(Math.log10(input.qty) - Math.log10(record.qty));
  score += Math.max(0, 1.8 - qtyDistance * 1.2);

  const sizeDistance = Math.abs(Math.log10(input.fileKb) - Math.log10(record.fileKb));
  score += Math.max(0, 1.7 - sizeDistance * 1.3);

  const complexityDistance = Math.abs(input.complexity - record.complexity);
  score += Math.max(0, 1.2 - complexityDistance * 1.4);

  return score;
}

function buildHistoricalAdjustment(input, trainingRecords) {
  const comparables = (trainingRecords || [])
    .filter((record) => Number(record.actualPrice) > 0)
    .map(buildComparable)
    .map((record) => ({
      ...record,
      score: scoreComparable(input, record)
    }))
    .filter((record) => record.score > 2.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!comparables.length) {
    return {
      matchedRecords: [],
      historicalTotal: null,
      historicalUnit: null,
      confidence: "low"
    };
  }

  const totalWeight = comparables.reduce((sum, record) => sum + record.score, 0);
  const weightedUnit = comparables.reduce((sum, record) => sum + record.unitPrice * record.score, 0) / totalWeight;
  const weightedSetup = comparables.reduce((sum, record) => {
    const setupProxy = Math.max(0, record.actualPrice - record.unitPrice * record.qty * 0.88);
    return sum + setupProxy * record.score;
  }, 0) / totalWeight;

  const inputQuantityDiscount = getQuantityDiscount(input.qty);
  const historicalUnit = weightedUnit * (input.material.factor / 1.12) * (input.machine.factor / 1.03);
  const historicalTotal = weightedSetup + historicalUnit * input.qty * inputQuantityDiscount;
  const confidence = comparables.length >= 3 ? "high" : "medium";

  return {
    matchedRecords: comparables,
    historicalTotal,
    historicalUnit: historicalUnit * inputQuantityDiscount,
    confidence
  };
}

function buildSummary(result) {
  const reasons = [
    `${result.material.normalized} material`,
    `${result.machine.normalized} process`,
    `${result.quantity} part quantity`,
    `${result.stpFileSizeKb} KB file size`
  ];

  if (result.matchCount > 0) {
    return `Hybrid estimate using machining heuristics plus ${result.matchCount} similar historical job${result.matchCount === 1 ? "" : "s"}. Inputs considered: ${reasons.join(", ")}.`;
  }

  return `Heuristic estimate using machining setup cost, material difficulty, process type, quantity discount, and file-complexity scoring. Inputs considered: ${reasons.join(", ")}.`;
}

function estimateQuote(payload, options = {}) {
  const qty = Math.max(1, Number(payload.quantity) || 1);
  const fileKb = Math.max(1, Number(payload.stpFileSizeKb) || 1);
  const heuristic = buildHeuristicEstimate(payload);
  const historical = buildHistoricalAdjustment(
    {
      qty,
      fileKb,
      material: heuristic.material,
      machine: heuristic.machine,
      complexity: heuristic.complexity
    },
    options.trainingRecords
  );

  const matchCount = historical.matchedRecords.length;
  const blendWeight = historical.matchedRecords.length
    ? historical.confidence === "high"
      ? 0.62
      : 0.4
    : 0;

  const total = historical.historicalTotal
    ? heuristic.total * (1 - blendWeight) + historical.historicalTotal * blendWeight
    : heuristic.total;
  const unitPrice = qty ? total / qty : total;

  return {
    estimatorMode: historical.matchedRecords.length ? "hybrid" : "heuristic",
    stpFileName: payload.stpFileName,
    stpFileSizeKb: fileKb,
    material: payload.material,
    normalizedMaterial: heuristic.material.normalized,
    machineType: heuristic.machine.normalized,
    quantity: qty,
    estimatePrice: roundMoney(total),
    estimatePerUnit: roundMoney(unitPrice),
    quantityDiscount: heuristic.quantityDiscount,
    complexityScore: Number(heuristic.complexity.toFixed(2)),
    matchedTrainingRecords: matchCount,
    matchedTrainingRecordIds: historical.matchedRecords.map((record) => record.id),
    confidence: historical.confidence,
    estimateSummary: buildSummary({
      material: heuristic.material,
      machine: heuristic.machine,
      quantity: qty,
      stpFileSizeKb: fileKb,
      matchCount
    })
  };
}

module.exports = {
  estimateQuote
};
