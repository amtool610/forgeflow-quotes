const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  addQuoteRequest,
  addTrainingRecord,
  createSession,
  createUser,
  deleteSession,
  getSession,
  getUserByEmail,
  getUserById,
  listQuoteRequests,
  listQuotesForUser,
  listTrainingRecords
} = require("./lib/store");
const { estimateQuote } = require("./lib/estimator");

const port = process.env.PORT || 3000;
const storageRoot = process.env.STORAGE_ROOT || process.cwd();
const publicDir = path.join(process.cwd(), "public");
const uploadsDir = path.join(storageRoot, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value || 0));
}

function layout({ title, user, body, pageClass = "" }) {
  const nav = user
    ? `<div class="nav-actions">
        <span class="pill">${safeText(user.role)}</span>
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
      <a class="brand" href="/">ForgeFlow Quotes</a>
      ${nav}
    </header>
    ${body}
  </body>
</html>`;
}

async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  if (!cookies.sessionId) return null;
  const session = await getSession(cookies.sessionId);
  if (!session) return null;
  return getUserById(session.userId);
}

function saveIncomingFile(file) {
  const extension = path.extname(file.name || ".stp") || ".stp";
  const fileName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  const targetPath = path.join(uploadsDir, fileName);
  const base64 = (file.base64 || "").split(",").pop();
  fs.writeFileSync(targetPath, Buffer.from(base64, "base64"));
  return {
    originalName: file.name,
    storedName: fileName,
    path: `/uploads/${fileName}`,
    sizeKb: Number(((file.size || 0) / 1024).toFixed(2))
  };
}

function landingPage(user) {
  const actions = user
    ? user.role === "admin"
      ? `<a class="solid-button" href="/admin">Open Admin Dashboard</a>`
      : `<a class="solid-button" href="/account">Open My Quotes</a>`
    : `<a class="solid-button" href="/signup">Create Customer Account</a>`;

  return layout({
    title: "ForgeFlow Quotes",
    user,
    pageClass: "home-page",
    body: `
      <main class="hero-shell">
        <section class="hero-card">
          <div class="eyebrow">Machine Shop Estimating Platform</div>
          <h1>Upload an STP file and get an instant machining estimate.</h1>
          <p class="lead">
            The current estimator uses quoting rules based on material, quantity, and file complexity.
            Later, this same workflow can switch to your trained model for tighter pricing.
          </p>
          <div class="hero-actions">
            ${actions}
            <a class="ghost-button" href="#estimate-form">Try Instant Estimate</a>
          </div>
        </section>
        <section class="panel estimate-panel" id="estimate-form">
          <div class="panel-header">
            <h2>Customer Estimate Request</h2>
            <p>Customers must sign in before submitting a quote request. Anyone can test the estimator below.</p>
          </div>
          <form id="estimate-form-ui" class="stack-form">
            <label>
              <span>STP File</span>
              <input type="file" name="stpFile" accept=".stp,.step,.stl,.iges,.igs" required />
            </label>
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
            <h3>Admin Training Intake</h3>
            <p>Admins can store real production data with uploaded STP files, material, quantity, shop notes, and actual price.</p>
          </article>
          <article class="panel">
            <h3>Customer Accounts</h3>
            <p>Customers can create an account, request estimates, and track their quote history from one place.</p>
          </article>
          <article class="panel">
            <h3>Future Model Upgrade</h3>
            <p>The estimator is already isolated behind a service boundary so you can swap in a trained model later.</p>
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
    title: isSignup ? "Create Account" : "Login",
    user,
    body: `
      <main class="auth-shell">
        <section class="panel auth-panel">
          <div class="panel-header">
            <h1>${isSignup ? "Create Customer Account" : "Login"}</h1>
            <p>${isSignup ? "Customers can submit estimate requests and review quote history." : "Use the seeded admin account or your customer login."}</p>
          </div>
          ${message ? `<div class="notice">${safeText(message)}</div>` : ""}
          <form class="stack-form" method="post" action="${isSignup ? "/signup" : "/login"}">
            ${isSignup ? `<label><span>Name</span><input name="name" required /></label>` : ""}
            ${isSignup ? `<label><span>Company</span><input name="company" /></label>` : ""}
            <label><span>Email</span><input type="email" name="email" required /></label>
            <label><span>Password</span><input type="password" name="password" required /></label>
            <button class="solid-button" type="submit">${isSignup ? "Create Account" : "Login"}</button>
          </form>
          <p class="muted">Admin seed: admin@machineshop.local / admin123</p>
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
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="5">No estimate requests yet.</td></tr>`;

  return layout({
    title: "My Quotes",
    user,
    body: `
      <main class="dashboard-shell">
        <section class="panel">
          <div class="panel-header">
            <h1>Submit Quote Request</h1>
            <p>This creates a customer estimate and stores the request for admin review.</p>
          </div>
          <form id="customer-quote-form" class="stack-form">
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

function serveUpload(res, pathname) {
  const target = path.join(uploadsDir, pathname.replace(/^\/uploads\//, ""));
  if (!target.startsWith(uploadsDir) || !fs.existsSync(target)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/octet-stream" });
  res.end(fs.readFileSync(target));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const user = await getCurrentUser(req);

    if (pathname === "/styles.css" || pathname === "/app.js") {
      if (serveStatic(res, pathname)) return;
    }

    if (pathname.startsWith("/uploads/")) {
      serveUpload(res, pathname);
      return;
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
      const existing = await getUserByEmail(body.email);
      if (!existing || existing.password !== body.password) {
        sendHtml(res, authPage("login", "Invalid email or password."));
        return;
      }
      const session = await createSession(existing.id);
      redirect(res, existing.role === "admin" ? "/admin" : "/account", {
        "Set-Cookie": `sessionId=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax`
      });
      return;
    }

    if (req.method === "GET" && pathname === "/signup") {
      sendHtml(res, authPage("signup"));
      return;
    }

    if (req.method === "POST" && pathname === "/signup") {
      const body = parseFormEncoded(await readBody(req));
      if (await getUserByEmail(body.email)) {
        sendHtml(res, authPage("signup", "An account already exists for that email."));
        return;
      }
      const userRecord = await createUser(body);
      const session = await createSession(userRecord.id);
      redirect(res, "/account", {
        "Set-Cookie": `sessionId=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax`
      });
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
      const fileMeta = saveIncomingFile(payload.stpFile);
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
      const fileMeta = saveIncomingFile(payload.stpFile);
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
      const fileMeta = saveIncomingFile(payload.stpFile);
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
  console.log(`ForgeFlow Quotes running at http://localhost:${port}`);
});
