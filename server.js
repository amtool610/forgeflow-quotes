const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  addQuoteRequest,
  addTrainingRecord,
  createSession,
  deleteSession,
  ensureUserProfile,
  getSession,
  getUserByEmail,
  getUserById,
  listQuoteRequests,
  listQuotesForUser,
  listTrainingRecords,
  mapAuthError,
  signInWithFirebaseAuth,
  signUpWithFirebaseAuth
} = require("./lib/store");
const { estimateQuote } = require("./lib/estimator");

const port = process.env.PORT || 3000;
const storageRoot = process.env.STORAGE_ROOT || process.cwd();
const publicDir = path.join(process.cwd(), "public");
const companyName = process.env.COMPANY_NAME || "SMART";
const appName = `${companyName} Estimates`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw.split(";").reduce((all, part) => {
    const [key, ...value] = part.trim().split("=");
    if (!key) return all;
    all[key] = decodeURIComponent(value.join("="));
    return all;
  }, {});
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
}

function safeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapePdf(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ");
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value || 0));
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function layout({ title, user, body, pageClass = "" }) {
  const nav = user
    ? `<div class="nav-actions">
        <span>${safeText(user.name)}</span>
        <form method="post" action="/logout">
          <button class="ghost-button" type="submit">Logout</button>
        </form>
      </div>`
    : `<div class="nav-actions">
        <a class="ghost-button" href="/login">Login</a>
        <a class="solid-button" href="/signup">Create Account</a>
      </div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeText(title)}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="${safeText(pageClass)}">
    <header class="site-header">
      <a class="brand" href="/">${safeText(appName)}</a>
      ${nav}
    </header>
    ${body}
  </body>
</html>`;
}

function buildPdfBuffer({ quote, customer }) {
  const lines = [
    companyName,
    "Estimate",
    `Estimate ID: ${quote.id}`,
    `Date: ${formatDate(quote.createdAt)}`,
    "",
    `Customer: ${customer.name || quote.customerName || ""}`,
    `Email: ${customer.email || quote.customerEmail || ""}`,
    `Company: ${customer.company || ""}`,
    "",
    `Part File: ${quote.stpFile.originalName}`,
    `File Size: ${quote.stpFile.sizeKb} KB`,
    `Material: ${quote.material}`,
    `Quantity: ${quote.quantity}`,
    `Machine Type: ${quote.estimate.machineType || "General machining"}`,
    "",
    `Estimated Unit Price: ${formatMoney(quote.estimate.estimatePerUnit)}`,
    `Estimated Total: ${formatMoney(quote.estimate.estimatePrice)}`,
    `Estimator Mode: ${quote.estimate.estimatorMode}`,
    `Confidence: ${quote.estimate.confidence || "n/a"}`,
    "",
    "Estimate Summary:",
    quote.estimate.estimateSummary || "",
    "",
    "Notes:",
    quote.notes || "No additional notes provided.",
    "",
    "This estimate is for review only and may be updated after production review."
  ];

  const contentLines = [];
  let y = 760;
  contentLines.push("BT");
  contentLines.push("/F1 22 Tf");
  contentLines.push("50 770 Td");
  contentLines.push(`(${escapePdf(companyName)}) Tj`);
  contentLines.push("0 -22 Td");
  contentLines.push("/F1 12 Tf");
  contentLines.push("(Machining Estimate) Tj");

  y = 720;
  for (const line of lines.slice(2)) {
    const fontSize = line === "Estimate Summary:" || line === "Notes:" ? 12 : 11;
    contentLines.push("ET");
    contentLines.push("BT");
    contentLines.push(`/F1 ${fontSize} Tf`);
    contentLines.push(`50 ${y} Td`);
    contentLines.push(`(${escapePdf(line)}) Tj`);
    y -= line ? 16 : 10;
    if (y < 60) break;
  }
  contentLines.push("ET");

  const content = contentLines.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  if (!cookies.sessionId) return null;
  const session = await getSession(cookies.sessionId);
  if (!session) return null;
  return getUserById(session.userId);
}

function buildIncomingFileMeta(file) {
  const extension = path.extname(file.name || ".stp") || ".stp";
  return {
    originalName: file.name,
    extension,
    sizeKb: Number(((file.size || 0) / 1024).toFixed(2))
  };
}

function landingPage(user) {
  const actions = user
    ? user.role === "admin"
      ? `<a class="solid-button" href="/admin">Open Dashboard</a>`
      : `<a class="solid-button" href="/account">Open My Quotes</a>`
    : `<a class="solid-button" href="/signup">Create Customer Account</a>`;

  return layout({
    title: appName,
    user,
    pageClass: "home-page",
    body: `
      <main class="hero-shell">
        <section class="hero-card">
          <div class="eyebrow">Machine Shop Estimating Platform</div>
          <h1>Upload an STP file and get an instant machining estimate.</h1>
          <p class="lead">
            Upload your part file, choose the material, enter quantity, and get a fast machining estimate.
            Customer accounts can save quote requests and track estimate history in one place.
          </p>
          <div class="hero-actions">
            ${actions}
            <a class="ghost-button" href="#estimate-form">Try Instant Estimate</a>
          </div>
        </section>
        <section class="panel estimate-panel" id="estimate-form">
          <div class="panel-header">
            <h2>Instant Estimate</h2>
            <p>Try the estimator below. Sign in when you are ready to submit a formal quote request.</p>
          </div>
          <form id="estimate-form-ui" class="stack-form">
            <label>
              <span>STP File</span>
              <input type="file" name="stpFile" accept=".stp,.step,.stl,.iges,.igs" required />
            </label>
            <div class="file-review hidden" id="estimate-file-review"></div>
            <label>
              <span>Material Type</span>
              <input type="text" name="material" placeholder="Aluminum 6061" required />
            </label>
            <label>
              <span>Quantity</span>
              <input type="number" name="quantity" min="1" value="1" required />
            </label>
            <button class="solid-button" type="submit">Calculate Estimate</button>
          </form>
          <div id="estimate-result" class="result-card hidden"></div>
        </section>
        <section class="info-grid">
          <article class="panel">
            <h3>Fast Quote Requests</h3>
            <p>Upload your part file, select a material, set quantity, and get a pricing estimate before submitting.</p>
          </article>
          <article class="panel">
            <h3>Customer Accounts</h3>
            <p>Customers can create an account, request estimates, and track their quote history from one place.</p>
          </article>
          <article class="panel">
            <h3>Quote History</h3>
            <p>Keep all quote requests organized by account so repeat orders and revisions are easier to manage.</p>
          </article>
        </section>
      </main>
      <script src="/app.js"></script>
    `
  });
}

function authPage(mode, message = "", user = null) {
  const isSignup = mode === "signup";
  return layout({
    title: isSignup ? `Create Account | ${appName}` : `Login | ${appName}`,
    user,
    body: `
      <main class="auth-shell">
        <section class="panel auth-panel">
          <div class="panel-header">
            <h1>${isSignup ? "Create Account" : "Login"}</h1>
            <p>${isSignup ? "Create an account to submit quote requests and review quote history." : "Sign in to submit quote requests and review your quote history."}</p>
          </div>
          ${message ? `<div class="notice">${safeText(message)}</div>` : ""}
          <form class="stack-form" method="post" action="${isSignup ? "/signup" : "/login"}">
            ${isSignup ? `<label><span>Name</span><input name="name" required /></label>` : ""}
            ${isSignup ? `<label><span>Company</span><input name="company" /></label>` : ""}
            <label><span>Email</span><input type="email" name="email" required /></label>
            <label><span>Password</span><input type="password" name="password" required /></label>
            <button class="solid-button" type="submit">${isSignup ? "Create Account" : "Login"}</button>
          </form>
        </section>
      </main>
    `
  });
}

async function accountPage(user) {
  const quotes = await listQuotesForUser(user.id);
  const quoteRows = quotes.length
    ? quotes
        .map(
          (quote) => `
            <tr>
              <td>${safeText(quote.stpFile.originalName)}</td>
              <td>${safeText(quote.material)}</td>
              <td>${safeText(quote.quantity)}</td>
              <td>${formatMoney(quote.estimate.estimatePrice)}</td>
              <td>${safeText(new Date(quote.createdAt).toLocaleString())}</td>
              <td><a class="ghost-button table-button" href="/quotes/${quote.id}/pdf" target="_blank" rel="noopener">Download PDF</a></td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="6">No estimate requests yet.</td></tr>`;

  return layout({
    title: "My Quotes",
    user,
    body: `
      <main class="dashboard-shell">
        <section class="panel">
          <div class="panel-header">
            <h1>Submit Quote Request</h1>
            <p>Upload your part details to generate and save a quote request.</p>
          </div>
          <form id="customer-quote-form" class="stack-form">
            <label>
              <span>STP File</span>
              <input type="file" name="stpFile" accept=".stp,.step,.stl,.iges,.igs" required />
            </label>
            <div class="file-review hidden" id="customer-file-review"></div>
            <label>
              <span>Material Type</span>
              <input type="text" name="material" required />
            </label>
            <label>
              <span>Quantity</span>
              <input type="number" name="quantity" min="1" value="1" required />
            </label>
            <label>
              <span>Notes</span>
              <textarea name="notes" rows="4" placeholder="Tolerance, finish, lead time"></textarea>
            </label>
            <button class="solid-button" type="submit">Submit Quote Request</button>
          </form>
          <div id="customer-quote-result" class="result-card hidden"></div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <h2>My Quote History</h2>
            <p>Stored estimates for this customer account.</p>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Material</th>
                  <th>Qty</th>
                  <th>Estimate</th>
                  <th>Created</th>
                  <th>PDF</th>
                </tr>
              </thead>
              <tbody>${quoteRows}</tbody>
            </table>
          </div>
        </section>
      </main>
      <script src="/app.js"></script>
    `
  });
}

async function adminPage(user) {
  const quotes = await listQuoteRequests();
  const training = await listTrainingRecords();

  const quoteCards = quotes.length
    ? quotes
        .map(
          (quote) => `
          <article class="mini-card">
            <h3>${safeText(quote.customerName)} · ${safeText(quote.material)}</h3>
            <p>${safeText(quote.stpFile.originalName)} · Qty ${safeText(quote.quantity)} · ${formatMoney(quote.estimate.estimatePrice)}</p>
            <p class="muted">${safeText(quote.notes || "No customer notes")}</p>
          </article>
        `
        )
        .join("")
    : `<p class="muted">No quote requests yet.</p>`;

  const trainingRows = training.length
    ? training
        .map(
          (record) => `
            <tr>
              <td>${safeText(record.stpFile.originalName)}</td>
              <td>${safeText(record.material)}</td>
              <td>${safeText(record.quantity)}</td>
              <td>${formatMoney(record.actualPrice)}</td>
              <td>${safeText(record.machineType || "-")}</td>
              <td>${safeText(new Date(record.createdAt).toLocaleString())}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="6">No training records yet.</td></tr>`;

  return layout({
    title: "Admin Dashboard",
    user,
    body: `
      <main class="dashboard-shell admin-shell">
        <section class="panel">
          <div class="panel-header">
            <h1>Admin Training Data Intake</h1>
            <p>This page is for admins only. Store real-world machining jobs for future model training.</p>
          </div>
          <form id="training-form" class="stack-form">
            <label>
              <span>STP File</span>
              <input type="file" name="stpFile" accept=".stp,.step,.stl,.iges,.igs" required />
            </label>
            <label>
              <span>Material Type</span>
              <input type="text" name="material" required />
            </label>
            <label>
              <span>Quantity</span>
              <input type="number" name="quantity" min="1" value="1" required />
            </label>
            <label>
              <span>Actual Price</span>
              <input type="number" name="actualPrice" min="0" step="0.01" required />
            </label>
            <label>
              <span>Machine Type</span>
              <input type="text" name="machineType" placeholder="3-axis mill, lathe, EDM" />
            </label>
            <label>
              <span>Shop Notes</span>
              <textarea name="notes" rows="4" placeholder="Tolerance, setup count, finishing, lead time"></textarea>
            </label>
            <button class="solid-button" type="submit">Save Training Record</button>
          </form>
          <div id="training-result" class="result-card hidden"></div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <h2>Incoming Customer Requests</h2>
            <p>All submitted estimate requests across customer accounts.</p>
          </div>
          <div class="card-grid">${quoteCards}</div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <h2>Training Dataset Preview</h2>
            <p>Real jobs stored for future model training.</p>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Material</th>
                  <th>Qty</th>
                  <th>Actual Price</th>
                  <th>Machine</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>${trainingRows}</tbody>
            </table>
          </div>
        </section>
      </main>
      <script src="/app.js"></script>
    `
  });
}

function parseFormEncoded(body) {
  const params = new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

function serveStatic(res, pathname) {
  const target = path.join(publicDir, pathname.replace(/^\/+/, ""));
  if (!target.startsWith(publicDir) || !fs.existsSync(target)) {
    return false;
  }

  const ext = path.extname(target);
  const typeMap = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  };
  res.writeHead(200, { "Content-Type": typeMap[ext] || "application/octet-stream" });
  res.end(fs.readFileSync(target));
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const user = await getCurrentUser(req);

    if (pathname === "/styles.css" || pathname === "/app.js") {
      if (serveStatic(res, pathname)) return;
    }

    if (req.method === "GET" && pathname === "/") {
      sendHtml(res, landingPage(user));
      return;
    }

    if (req.method === "GET" && pathname === "/login") {
      sendHtml(res, authPage("login"));
      return;
    }

    if (req.method === "POST" && pathname === "/login") {
      const body = parseFormEncoded(await readBody(req));
      try {
        const authUser = await signInWithFirebaseAuth({
          email: body.email,
          password: body.password
        });
        const existing = await ensureUserProfile({
          id: authUser.localId,
          firebaseUid: authUser.localId,
          email: body.email,
          name: body.email.split("@")[0],
          company: ""
        });
        const session = await createSession(existing.id);
        redirect(res, existing.role === "admin" ? "/admin" : "/account", {
          "Set-Cookie": `sessionId=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax`
        });
      } catch (error) {
        sendHtml(res, authPage("login", mapAuthError(error)));
        return;
      }
      return;
    }

    if (req.method === "GET" && pathname === "/signup") {
      sendHtml(res, authPage("signup"));
      return;
    }

    if (req.method === "POST" && pathname === "/signup") {
      const body = parseFormEncoded(await readBody(req));
      try {
        const authUser = await signUpWithFirebaseAuth({
          email: body.email,
          password: body.password
        });
        const userRecord = await ensureUserProfile({
          id: authUser.localId,
          firebaseUid: authUser.localId,
          name: body.name,
          email: body.email,
          company: body.company || ""
        });
        const session = await createSession(userRecord.id);
        redirect(res, userRecord.role === "admin" ? "/admin" : "/account", {
          "Set-Cookie": `sessionId=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax`
        });
      } catch (error) {
        sendHtml(res, authPage("signup", mapAuthError(error)));
        return;
      }
      return;
    }

    if (req.method === "POST" && pathname === "/logout") {
      const cookies = parseCookies(req);
      if (cookies.sessionId) await deleteSession(cookies.sessionId);
      redirect(res, "/", {
        "Set-Cookie": "sessionId=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax"
      });
      return;
    }

    if (req.method === "GET" && pathname === "/account") {
      if (!user || user.role !== "customer") {
        redirect(res, "/login");
        return;
      }
      sendHtml(res, await accountPage(user));
      return;
    }

    if (req.method === "GET" && /^\/quotes\/[^/]+\/pdf$/.test(pathname)) {
      if (!user) {
        redirect(res, "/login");
        return;
      }
      const quoteId = pathname.split("/")[2];
      const quotes = user.role === "admin" ? await listQuoteRequests() : await listQuotesForUser(user.id);
      const quote = quotes.find((item) => item.id === quoteId);
      if (!quote) {
        sendJson(res, 404, { error: "Quote not found" });
        return;
      }
      const pdfBuffer = buildPdfBuffer({ quote, customer: user });
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quote.id}.pdf"`,
        "Content-Length": pdfBuffer.length
      });
      res.end(pdfBuffer);
      return;
    }

    if (req.method === "GET" && pathname === "/admin") {
      if (!user || user.role !== "admin") {
        redirect(res, "/login");
        return;
      }
      sendHtml(res, await adminPage(user));
      return;
    }

    if (req.method === "POST" && pathname === "/api/estimate-preview") {
      const payload = JSON.parse(await readBody(req));
      const fileMeta = buildIncomingFileMeta(payload.stpFile);
      const estimate = estimateQuote({
        stpFileName: fileMeta.originalName,
        stpFileSizeKb: fileMeta.sizeKb,
        material: payload.material,
        quantity: payload.quantity,
        machineType: payload.machineType || "",
        notes: payload.notes || ""
      }, {
        trainingRecords: await listTrainingRecords()
      });
      sendJson(res, 200, { estimate, stpFile: fileMeta });
      return;
    }

    if (req.method === "POST" && pathname === "/api/customer/quotes") {
      if (!user || user.role !== "customer") {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      const payload = JSON.parse(await readBody(req));
      const fileMeta = buildIncomingFileMeta(payload.stpFile);
      const estimate = estimateQuote({
        stpFileName: fileMeta.originalName,
        stpFileSizeKb: fileMeta.sizeKb,
        material: payload.material,
        quantity: payload.quantity,
        machineType: payload.machineType || "",
        notes: payload.notes || ""
      }, {
        trainingRecords: await listTrainingRecords()
      });
      const quote = await addQuoteRequest({
        customerId: user.id,
        customerName: user.name,
        customerEmail: user.email,
        material: payload.material,
        quantity: Number(payload.quantity),
        notes: payload.notes || "",
        stpFile: fileMeta,
        estimate
      });
      sendJson(res, 200, { quote });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/training-records") {
      if (!user || user.role !== "admin") {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      const payload = JSON.parse(await readBody(req));
      const fileMeta = buildIncomingFileMeta(payload.stpFile);
      const estimate = estimateQuote({
        stpFileName: fileMeta.originalName,
        stpFileSizeKb: fileMeta.sizeKb,
        material: payload.material,
        quantity: payload.quantity,
        machineType: payload.machineType || "",
        notes: payload.notes || ""
      }, {
        trainingRecords: await listTrainingRecords()
      });
      const trainingRecord = await addTrainingRecord({
        material: payload.material,
        quantity: Number(payload.quantity),
        actualPrice: Number(payload.actualPrice),
        machineType: payload.machineType || "",
        notes: payload.notes || "",
        stpFile: fileMeta,
        baselineEstimate: estimate
      });
      sendJson(res, 200, { trainingRecord });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`${appName} running at http://localhost:${port}`);
});
