function normalizeMaterial(material) {
  return String(material || "").trim().toLowerCase();
}

function getMaterialFactor(material) {
  const value = normalizeMaterial(material);
  const lookup = {
    aluminum: 1.1,
    "stainless steel": 1.55,
    steel: 1.35,
    brass: 1.45,
    copper: 1.65,
    titanium: 2.4,
    plastic: 0.85,
    delrin: 0.9,
    abs: 0.82
  };

  return lookup[value] || 1.2;
}

function estimateFromInputs({ stpFileName, stpFileSizeKb, material, quantity }) {
  const qty = Math.max(1, Number(quantity) || 1);
  const fileKb = Math.max(1, Number(stpFileSizeKb) || 1);
  const materialFactor = getMaterialFactor(material);

  const setupCost = 65;
  const geometryFactor = Math.min(4.5, 1 + fileKb / 900);
  const unitMachining = 24 * materialFactor * geometryFactor;
  const quantityDiscount = qty >= 100 ? 0.76 : qty >= 25 ? 0.84 : qty >= 10 ? 0.91 : 1;
  const rawUnitPrice = unitMachining * quantityDiscount;
  const total = setupCost + rawUnitPrice * qty;

  return {
    estimatorMode: "rules",
    stpFileName,
    stpFileSizeKb: fileKb,
    material,
    quantity: qty,
    estimatePrice: Number(total.toFixed(2)),
    estimatePerUnit: Number(rawUnitPrice.toFixed(2)),
    estimateSummary: `Rules-based estimate using material factor ${materialFactor.toFixed(2)} and geometry factor ${geometryFactor.toFixed(2)}.`
  };
}

function estimateQuote(payload) {
  return estimateFromInputs(payload);
}

module.exports = {
  estimateQuote
};
