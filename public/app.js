async function fileToPayload(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return {
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    base64: btoa(binary)
  };
}

function showResult(targetId, html, isError = false) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.classList.remove("hidden");
  target.classList.toggle("error", isError);
  target.innerHTML = html;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value || 0));
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Request failed");
  }
  return result;
}

async function bindEstimatePreview() {
  const form = document.getElementById("estimate-form-ui");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = form.stpFile.files[0];
    if (!file) {
      showResult("estimate-result", "Select an STP file first.", true);
      return;
    }

    try {
      const payload = {
        stpFile: await fileToPayload(file),
        material: form.material.value,
        quantity: form.quantity.value
      };
      const result = await postJson("/api/estimate-preview", payload);
      showResult(
        "estimate-result",
        `<h3>Estimated Total: ${money(result.estimate.estimatePrice)}</h3>
         <p>${result.estimate.estimateSummary}</p>
         <p>Estimated unit price: ${money(result.estimate.estimatePerUnit)}</p>
         <p class="muted">Sign in to submit this as a formal quote request.</p>`
      );
    } catch (error) {
      showResult("estimate-result", error.message, true);
    }
  });
}

async function bindCustomerQuoteForm() {
  const form = document.getElementById("customer-quote-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = form.stpFile.files[0];
    if (!file) {
      showResult("customer-quote-result", "Select an STP file first.", true);
      return;
    }

    try {
      const payload = {
        stpFile: await fileToPayload(file),
        material: form.material.value,
        quantity: form.quantity.value,
        notes: form.notes.value
      };
      const result = await postJson("/api/customer/quotes", payload);
      showResult(
        "customer-quote-result",
        `<h3>Quote request submitted.</h3>
         <p>Estimated total: ${money(result.quote.estimate.estimatePrice)}</p>
         <p>Your admin team can now review this request in the dashboard.</p>`
      );
      form.reset();
    } catch (error) {
      showResult("customer-quote-result", error.message, true);
    }
  });
}

async function bindTrainingForm() {
  const form = document.getElementById("training-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = form.stpFile.files[0];
    if (!file) {
      showResult("training-result", "Select an STP file first.", true);
      return;
    }

    try {
      const payload = {
        stpFile: await fileToPayload(file),
        material: form.material.value,
        quantity: form.quantity.value,
        actualPrice: form.actualPrice.value,
        machineType: form.machineType.value,
        notes: form.notes.value
      };
      const result = await postJson("/api/admin/training-records", payload);
      showResult(
        "training-result",
        `<h3>Training record saved.</h3>
         <p>Baseline rules estimate: ${money(result.trainingRecord.baselineEstimate.estimatePrice)}</p>
         <p>Actual price captured: ${money(result.trainingRecord.actualPrice)}</p>`
      );
      form.reset();
    } catch (error) {
      showResult("training-result", error.message, true);
    }
  });
}

bindEstimatePreview();
bindCustomerQuoteForm();
bindTrainingForm();
