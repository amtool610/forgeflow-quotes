const fs = require("fs");
const path = require("path");

const storageRoot = process.env.STORAGE_ROOT || process.cwd();
const dataDir = path.join(storageRoot, "data");
const dbPath = path.join(dataDir, "db.json");

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyDGOSPdvAQpOCMkbrXX3W2Gkxnb_zzVM8M",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "companywebsite-a1f7f.firebaseapp.com",
  databaseURL:
    process.env.FIREBASE_DATABASE_URL || "https://companywebsite-a1f7f-default-rtdb.firebaseio.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "companywebsite-a1f7f",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "companywebsite-a1f7f.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "424197049927",
  appId: process.env.FIREBASE_APP_ID || "1:424197049927:web:61dcdbe5b70100b24eeb62"
};

const adminEmails = new Set(
  String(process.env.ADMIN_EMAILS || "admin@machineshop.local,m20371825@gmail.com")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const seed = {
  users: {
    "admin-1": {
      id: "admin-1",
      name: "Shop Admin",
      email: "admin@machineshop.local",
      role: "admin",
      company: "Internal"
    }
  },
  quoteRequests: {},
  trainingRecords: {},
  sessions: {}
};

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readLocalDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(seed, null, 2));
  }

  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeLocalDb(db) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

async function firebaseRequest(method, targetPath, body) {
  const slashPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  const url = `${firebaseConfig.databaseURL}${slashPath}.json`;
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Firebase request failed with status ${response.status}`);
  }

  return response.status === 204 ? null : response.json();
}

async function firebaseAuthRequest(endpoint, body) {
  const url = `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${firebaseConfig.apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();

  if (!response.ok) {
    const message = result?.error?.message || "AUTH_ERROR";
    throw new Error(message);
  }

  return result;
}

async function readFirebaseDb() {
  const db = await firebaseRequest("GET", "/", undefined);
  if (db) return db;
  await firebaseRequest("PUT", "/", seed);
  return JSON.parse(JSON.stringify(seed));
}

async function writeFirebaseValue(targetPath, value) {
  await firebaseRequest("PUT", targetPath, value);
}

function mapCollection(collection) {
  return Object.values(collection || {});
}

async function readDb() {
  try {
    return await readFirebaseDb();
  } catch (error) {
    return readLocalDb();
  }
}

async function getUserByEmail(email) {
  const db = await readDb();
  return mapCollection(db.users).find(
    (user) => user.email.toLowerCase() === String(email || "").toLowerCase()
  );
}

async function createUser(payload) {
  const db = await readDb();
  const normalizedEmail = String(payload.email || "").toLowerCase();
  const user = {
    id: payload.id || payload.firebaseUid || createId("user"),
    firebaseUid: payload.firebaseUid || payload.id || null,
    name: payload.name,
    email: payload.email,
    company: payload.company || "",
    role: adminEmails.has(normalizedEmail) ? "admin" : payload.role || "customer"
  };
  db.users = db.users || {};
  db.users[user.id] = user;
  try {
    await writeFirebaseValue(`/users/${user.id}`, user);
  } catch (error) {
    writeLocalDb(db);
  }
  return user;
}

async function updateUser(userId, updates) {
  const db = await readDb();
  const existing = (db.users || {})[userId];
  if (!existing) return null;

  const user = {
    ...existing,
    ...updates
  };
  db.users[userId] = user;
  try {
    await writeFirebaseValue(`/users/${userId}`, user);
  } catch (error) {
    writeLocalDb(db);
  }
  return user;
}

async function ensureUserProfile(payload) {
  const existing =
    (payload.id && (await getUserById(payload.id))) ||
    (payload.email && (await getUserByEmail(payload.email)));

  if (!existing) {
    return createUser(payload);
  }

  const nextUpdates = {};
  if (payload.name && payload.name !== existing.name) nextUpdates.name = payload.name;
  if (payload.company && payload.company !== existing.company) nextUpdates.company = payload.company;
  if (payload.firebaseUid && payload.firebaseUid !== existing.firebaseUid) {
    nextUpdates.firebaseUid = payload.firebaseUid;
  }

  const normalizedEmail = String(existing.email || payload.email || "").toLowerCase();
  const targetRole = adminEmails.has(normalizedEmail) ? "admin" : existing.role || "customer";
  if (targetRole !== existing.role) nextUpdates.role = targetRole;

  if (!Object.keys(nextUpdates).length) return existing;
  return updateUser(existing.id, nextUpdates);
}

function mapAuthError(error) {
  const code = String(error && error.message ? error.message : error);
  const lookup = {
    EMAIL_EXISTS: "An account already exists for that email.",
    INVALID_PASSWORD: "Invalid email or password.",
    EMAIL_NOT_FOUND: "Invalid email or password.",
    INVALID_LOGIN_CREDENTIALS: "Invalid email or password.",
    USER_DISABLED: "This account has been disabled.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "Too many login attempts. Try again later.",
    OPERATION_NOT_ALLOWED: "Email/password sign-in is not enabled in Firebase Authentication."
  };
  return lookup[code] || "Authentication failed.";
}

async function signUpWithFirebaseAuth({ email, password }) {
  return firebaseAuthRequest("accounts:signUp", {
    email,
    password,
    returnSecureToken: true
  });
}

async function signInWithFirebaseAuth({ email, password }) {
  return firebaseAuthRequest("accounts:signInWithPassword", {
    email,
    password,
    returnSecureToken: true
  });
}

async function createSession(userId) {
  const db = await readDb();
  const session = {
    id: createId("session"),
    userId,
    createdAt: new Date().toISOString()
  };
  db.sessions = db.sessions || {};
  Object.keys(db.sessions).forEach((key) => {
    if (db.sessions[key].userId === userId) {
      delete db.sessions[key];
    }
  });
  db.sessions[session.id] = session;
  try {
    await writeFirebaseValue("/sessions", db.sessions);
  } catch (error) {
    writeLocalDb(db);
  }
  return session;
}

async function getSession(sessionId) {
  const db = await readDb();
  return mapCollection(db.sessions).find((session) => session.id === sessionId) || null;
}

async function deleteSession(sessionId) {
  const db = await readDb();
  db.sessions = db.sessions || {};
  delete db.sessions[sessionId];
  try {
    await writeFirebaseValue("/sessions", db.sessions);
  } catch (error) {
    writeLocalDb(db);
  }
}

async function getUserById(userId) {
  const db = await readDb();
  return (db.users || {})[userId] || null;
}

async function addQuoteRequest(record) {
  const db = await readDb();
  const quote = {
    id: createId("quote"),
    ...record,
    createdAt: new Date().toISOString()
  };
  db.quoteRequests = db.quoteRequests || {};
  db.quoteRequests[quote.id] = quote;
  try {
    await writeFirebaseValue(`/quoteRequests/${quote.id}`, quote);
  } catch (error) {
    writeLocalDb(db);
  }
  return quote;
}

async function addTrainingRecord(record) {
  const db = await readDb();
  const trainingRecord = {
    id: createId("training"),
    ...record,
    createdAt: new Date().toISOString()
  };
  db.trainingRecords = db.trainingRecords || {};
  db.trainingRecords[trainingRecord.id] = trainingRecord;
  try {
    await writeFirebaseValue(`/trainingRecords/${trainingRecord.id}`, trainingRecord);
  } catch (error) {
    writeLocalDb(db);
  }
  return trainingRecord;
}

async function listQuoteRequests() {
  const db = await readDb();
  return mapCollection(db.quoteRequests).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function listTrainingRecords() {
  const db = await readDb();
  return mapCollection(db.trainingRecords).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}

async function listQuotesForUser(userId) {
  const quotes = await listQuoteRequests();
  return quotes.filter((quote) => quote.customerId === userId);
}

module.exports = {
  addQuoteRequest,
  addTrainingRecord,
  createSession,
  createUser,
  deleteSession,
  ensureUserProfile,
  mapAuthError,
  signInWithFirebaseAuth,
  signUpWithFirebaseAuth,
  getSession,
  getUserByEmail,
  getUserById,
  listQuoteRequests,
  listQuotesForUser,
  listTrainingRecords,
  readDb,
  firebaseConfig
};
