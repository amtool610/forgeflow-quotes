const fs = require("fs");
const path = require("path");

const storageRoot = process.env.STORAGE_ROOT || process.cwd();
const dataDir = path.join(storageRoot, "data");
const dbPath = path.join(dataDir, "db.json");

const seed = {
  users: [
    {
      id: "admin-1",
      name: "Shop Admin",
      email: "admin@machineshop.local",
      password: "admin123",
      role: "admin",
      company: "Internal"
    }
  ],
  quoteRequests: [],
  trainingRecords: [],
  sessions: []
};

function ensureDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(seed, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getUserByEmail(email) {
  const db = readDb();
  return db.users.find((user) => user.email.toLowerCase() === String(email || "").toLowerCase());
}

function createUser(payload) {
  const db = readDb();
  const user = {
    id: createId("user"),
    name: payload.name,
    email: payload.email,
    password: payload.password,
    company: payload.company || "",
    role: payload.role || "customer"
  };
  db.users.push(user);
  writeDb(db);
  return user;
}

function createSession(userId) {
  const db = readDb();
  const session = {
    id: createId("session"),
    userId,
    createdAt: new Date().toISOString()
  };
  db.sessions = db.sessions.filter((item) => item.userId !== userId);
  db.sessions.push(session);
  writeDb(db);
  return session;
}

function getSession(sessionId) {
  const db = readDb();
  return db.sessions.find((session) => session.id === sessionId) || null;
}

function deleteSession(sessionId) {
  const db = readDb();
  db.sessions = db.sessions.filter((session) => session.id !== sessionId);
  writeDb(db);
}

function getUserById(userId) {
  const db = readDb();
  return db.users.find((user) => user.id === userId) || null;
}

function addQuoteRequest(record) {
  const db = readDb();
  const quote = {
    id: createId("quote"),
    ...record,
    createdAt: new Date().toISOString()
  };
  db.quoteRequests.unshift(quote);
  writeDb(db);
  return quote;
}

function addTrainingRecord(record) {
  const db = readDb();
  const trainingRecord = {
    id: createId("training"),
    ...record,
    createdAt: new Date().toISOString()
  };
  db.trainingRecords.unshift(trainingRecord);
  writeDb(db);
  return trainingRecord;
}

function listQuoteRequests() {
  return readDb().quoteRequests;
}

function listTrainingRecords() {
  return readDb().trainingRecords;
}

function listQuotesForUser(userId) {
  return readDb().quoteRequests.filter((quote) => quote.customerId === userId);
}

module.exports = {
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
  listTrainingRecords,
  readDb
};
