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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatFileSize(size) {
  if (!size) return "0 KB";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

async function buildFileReview(file) {
  const text = await file.text();
  const normalized = text.replace(/\0/g, "");
  const snippet = normalized.split(/\r?\n/).slice(0, 20).join("\n").trim();
  const looksLikeStep = /ISO-10303|HEADER|DATA|ENDSEC/i.test(normalized);
  const extension = (file.name.split(".").pop() || "").toUpperCase();

  return {
    name: file.name,
    sizeLabel: formatFileSize(file.size),
    extension: extension || "FILE",
    looksLikeStep,
    snippet: snippet.slice(0, 1800)
  };
}

async function bindFileReview(formId, inputName, reviewId) {
  const form = document.getElementById(formId);
  const review = document.getElementById(reviewId);
  if (!form || !review) return;

  const input = form[inputName];
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) {
      review.classList.add("hidden");
      review.innerHTML = "";
      return;
    }

    try {
      const details = await buildFileReview(file);
      review.classList.remove("hidden");
      review.innerHTML = `
        <div class="file-review-header">
          <h3>Uploaded File Review</h3>
          <span class="pill">${escapeHtml(details.extension)}</span>
        </div>
        <div class="file-review-meta">
          <span><strong>Name:</strong> ${escapeHtml(details.name)}</span>
          <span><strong>Size:</strong> ${escapeHtml(details.sizeLabel)}</span>
          <span><strong>Format check:</strong> ${details.looksLikeStep ? "STEP text detected" : "File loaded for upload review"}</span>
        </div>
        <div class="file-review-window">
          <pre>${escapeHtml(details.snippet || "No readable text preview found. The file will still upload with the quote request.")}</pre>
        </div>
      `;
    } catch (error) {
      review.classList.remove("hidden");
      review.innerHTML = `
        <div class="file-review-header">
          <h3>Uploaded File Review</h3>
        </div>
        <div class="file-review-window">
          <pre>Preview unavailable for this file, but it is still attached and ready for upload.</pre>
        </div>
      `;
    }
  });
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
         <p>Your quote request has been saved to your account history.</p>
         <p><a class="ghost-button table-button" href="/quotes/${result.quote.id}/pdf" target="_blank" rel="noopener">Download Estimate PDF</a></p>`
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
bindFileReview("estimate-form-ui", "stpFile", "estimate-file-review");
bindFileReview("customer-quote-form", "stpFile", "customer-file-review");
