import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyCompress from "@fastify/compress";
import fastifyMultipart from "@fastify/multipart";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import xlsx from "xlsx";
import { v4 as uuidv4 } from "uuid";
import Job from "./models/Job.js";
import JobApplication from "./models/JobApplication.js";
import { v2 as cloudinary } from "cloudinary";
import nodemailer from "nodemailer";
import crypto from "crypto";

import Admin from "./models/Admin.js";
import SiteSettings from "./models/SiteSettings.js";
import WalkinRate from "./models/WalkinRate.js";
import ZipZone from "./models/ZipZone.js";
import UploadLog from "./models/UploadLog.js";
import Blog from "./models/Blog.js";
import { INITIAL_BLOG_POSTS } from "./seedBlogs.js";
import QuoteEnquiry from "./models/QuoteEnquiry.js";
import ServiceArea from "./models/ServiceArea.js";
import Subscriber from "./models/Subscriber.js";
import Customer from "./models/Customer.js";
import Shipment from "./models/Shipment.js";

// ============================================================
// COUNTRY CODE MAPPING
// ============================================================
const COUNTRY_CODE_MAP = {
  "UNITED STATES": "US",
  USA: "US",
  "U.S.A": "US",
  "UNITED KINGDOM": "GB",
  UK: "GB",
  "U.K.": "GB",
  AUSTRALIA: "AU",
  CANADA: "CA",
  INDIA: "IN",
  GERMANY: "DE",
  FRANCE: "FR",
  ITALY: "IT",
  SPAIN: "ES",
  JAPAN: "JP",
  CHINA: "CN",
  SINGAPORE: "SG",
  UAE: "AE",
  "UNITED ARAB EMIRATES": "AE",
  NETHERLANDS: "NL",
  BELGIUM: "BE",
  SWITZERLAND: "CH",
  SWEDEN: "SE",
  NORWAY: "NO",
  DENMARK: "DK",
  FINLAND: "FI",
  PORTUGAL: "PT",
  GREECE: "GR",
  IRELAND: "IE",
  "NEW ZEALAND": "NZ",
  "SOUTH AFRICA": "ZA",
  BRAZIL: "BR",
  MEXICO: "MX",
  RUSSIA: "RU",
  TURKEY: "TR",
  "SAUDI ARABIA": "SA",
  ISRAEL: "IL",
  "SOUTH KOREA": "KR",
  MALAYSIA: "MY",
  THAILAND: "TH",
  VIETNAM: "VN",
  PHILIPPINES: "PH",
  INDONESIA: "ID",
  PAKISTAN: "PK",
  BANGLADESH: "BD",
  EGYPT: "EG",
  KENYA: "KE",
  NIGERIA: "NG",
};

function getCountryCode(country) {
  if (!country) return null;

  const cleaned = String(country).trim().toUpperCase();

  if (cleaned.length === 2 && /^[A-Z]{2}$/.test(cleaned)) {
    return cleaned;
  }

  if (COUNTRY_CODE_MAP[cleaned]) {
    return COUNTRY_CODE_MAP[cleaned];
  }

  for (const [key, value] of Object.entries(COUNTRY_CODE_MAP)) {
    if (cleaned.includes(key) || key.includes(cleaned)) {
      return value;
    }
  }

  console.warn(`⚠️ Unknown country code: "${country}" - using as-is`);
  return country;
}
// ============================================================

// Simple in-memory cache utility
const apiCache = {
  data: {},
  get: function (key) {
    if (this.data[key] && this.data[key].expiry > Date.now())
      return this.data[key].value;
    return null;
  },
  set: function (key, value, ttlSeconds) {
    this.data[key] = { value, expiry: Date.now() + ttlSeconds * 1000 };
  },
  clear: function (key) {
    if (key) delete this.data[key];
    else this.data = {};
  },
};

async function rawBulkInsert(model, docs) {
  const chunkSize = 2000;
  const now = new Date();
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize).map((d) => ({
      ...d,
      createdAt: now,
      updatedAt: now,
    }));
    try {
      const result = await model.collection.insertMany(chunk, {
        ordered: false,
      });
      inserted += result.insertedCount || 0;
    } catch (bulkErr) {
      const insertedThisChunk = bulkErr.result?.insertedCount || 0;
      inserted += insertedThisChunk;
      failed += chunk.length - insertedThisChunk;
    }
  }
  return { inserted, failed };
}

dotenv.config();

if (!process.env.MONGODB_URI) {
  console.error("FATAL ERROR: MONGODB_URI is not defined.");
  process.exit(1);
}

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ============================================================
// NODEMAILER CONFIGURATION - FIXED
// ============================================================

console.log("📧 SMTP Configuration:");
console.log(`   Host: ${process.env.SMTP_HOST || "smtp.gmail.com"}`);
console.log(`   Port: ${process.env.SMTP_PORT || "587"}`);
console.log(`   User: ${process.env.SMTP_USER || "Not set"}`);
console.log(`   Pass: ${process.env.SMTP_PASS ? "****" : "Not set"}`);

// Create transporter with better configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true" || false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  pool: true,
  rateLimit: true,
  maxConnections: 1,
  maxMessages: 5,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

// Verify transporter connection
const verifyTransporter = async () => {
  try {
    await transporter.verify();
    console.log("✅ SMTP Server is ready to send emails");
    console.log(`   Using host: ${process.env.SMTP_HOST || "smtp.gmail.com"}`);
    console.log(`   Using user: ${process.env.SMTP_USER || "Not set"}`);
    return true;
  } catch (error) {
    console.error("❌ SMTP Configuration Error:", error.message);
    console.error("   Please check your SMTP credentials in .env file");
    console.error("   If using Gmail, make sure to use an App Password");
    console.error("   https://myaccount.google.com/apppasswords");
    return false;
  }
};

// ============================================================
// SEND EMAIL FUNCTION - FIXED
// ============================================================

async function sendEmail(to, subject, html, from = process.env.SMTP_USER) {
  try {
    console.log(`[Email] 📧 Attempting to send to: ${to}`);
    console.log(`[Email] 📝 Subject: ${subject}`);

    // Validate email
    if (!to || !to.includes("@")) {
      console.error(`[Email] ❌ Invalid email address: ${to}`);
      return { success: false, error: "Invalid email address" };
    }

    // Validate sender
    if (!from || !from.includes("@")) {
      console.error(`[Email] ❌ Invalid sender email: ${from}`);
      from = process.env.SMTP_USER;
      if (!from || !from.includes("@")) {
        return { success: false, error: "Invalid sender email" };
      }
    }

    const mailOptions = {
      from: `"Manvi International" <${from}>`,
      to: to,
      subject: subject,
      html: html,
      replyTo: from,
    };

    console.log(`[Email] 📤 Sending via SMTP...`);
    const info = await transporter.sendMail(mailOptions);
    console.log(
      `[Email] ✅ Email sent successfully! MessageId: ${info.messageId}`,
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[Email] ❌ Failed to send email:`, error.message);
    console.error(`[Email] 📋 Error details:`, error);
    return { success: false, error: error.message };
  }
}

// Verify immediately
verifyTransporter();

const fastify = Fastify({
  logger:
    process.env.NODE_ENV === "production"
      ? { level: "error" }
      : { level: process.env.LOG_LEVEL || "info" },
});
const frontendUrl = process.env.FRONTEND_URL || "*";
const cleanFrontendUrl = frontendUrl.replace(/\/$/, "");

fastify.register(fastifyCors, {
  origin: (origin, cb) => {
    if (!origin) {
      cb(null, true);
      return;
    }
    const originClean = origin.replace(/\/$/, "");
    if (
      cleanFrontendUrl === "*" ||
      originClean === cleanFrontendUrl ||
      originClean === "https://manvi-website.vercel.app" ||
      /https?:\/\/localhost(:\d+)?$/.test(originClean) ||
      /https?:\/\/127\.0\.0\.1(:\d+)?$/.test(originClean)
    ) {
      cb(null, true);
      return;
    }
    cb(new Error("Not allowed by CORS"), false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-database"],
  credentials: true,
});

fastify.register(fastifyCompress, { threshold: 1024 });
fastify.register(fastifyMultipart, { limits: { fileSize: 20 * 1024 * 1024 } });

fastify.register(fastifyRateLimit, {
  max: 1000,
  timeWindow: "1 minute",
  errorResponseBuilder: function (request, context) {
    return {
      statusCode: 429,
      error: "Too Many Requests",
      message: `I only allow ${context.max} requests per minute to this Website. Try again soon.`,
    };
  },
});

// ============= HEALTH CHECK & KEEP-ALIVE (PREVENTS COLD STARTS) =============
fastify.get("/health", async (request, reply) => {
  return { status: "ok", service: "manvi-node-server", timestamp: new Date().toISOString() };
});

fastify.get("/api/health", async (request, reply) => {
  return { status: "ok", service: "manvi-node-server", timestamp: new Date().toISOString() };
});

// ============= ROUTES =============

fastify.get("/", async () => ({
  status: "M5 Node Server is Running",
  version: "1.0.0",
}));

fastify.get("/site-settings", async (request, reply) => {
  try {
    const cached = apiCache.get("site-settings");
    if (cached) return { success: true, data: cached };
    let settings = await SiteSettings.findOne().lean();
    if (!settings) settings = await SiteSettings.create({});
    apiCache.set("site-settings", settings, 3600);
    return { success: true, data: settings };
  } catch {
    return reply
      .status(500)
      .send({ success: false, message: "Failed to fetch settings" });
  }
});

fastify.put("/site-settings", async (request, reply) => {
  try {
    const updated = await SiteSettings.findOneAndUpdate({}, request.body, {
      new: true,
      upsert: true,
    });
    apiCache.clear("site-settings");
    return { success: true, data: updated };
  } catch {
    return reply
      .status(500)
      .send({ success: false, message: "Failed to update settings" });
  }
});

fastify.post(
  "/admin/login",
  { config: { rateLimit: { max: 50, timeWindow: "1 minute" } } },
  async (request, reply) => {
    try {
      const { username, password } = request.body;
      const adminCount = await Admin.countDocuments();
      if (adminCount === 0) {
        const hash = await bcrypt.hash("password", 10);
        await Admin.create({ username: "admin", passwordHash: hash });
      }
      const admin = await Admin.findOne({ username });
      if (!admin)
        return reply
          .status(401)
          .send({ success: false, message: "Invalid credentials" });
      const match = await bcrypt.compare(password, admin.passwordHash);
      if (!match)
        return reply
          .status(401)
          .send({ success: false, message: "Invalid credentials" });
      return { success: true, message: "Login successful" };
    } catch (error) {
      return reply
        .status(500)
        .send({ success: false, message: "Login failed" });
    }
  },
);

// ===========================================================================
//  RATES SYSTEM
// ===========================================================================

const SERVICE_DESTINATION_MAP = {
  AUSTRALIA: [
    { service: "EX DEL AUS DIRECT", zipBased: true },
    { service: "EX DEL BRANDED DHL DOX", zoningCountry: "AUSTRALIA" },
    { service: "EX DEL BRANDED DHL NDOX", zoningCountry: "AUSTRALIA" },
    { service: "EX DEL BRANDED UPS NDOX", zoningCountry: "AUSTRALIA" },
    { service: "EX DEL BRANDED FEDEX NDOX", zoningCountry: "AUSTRALIA" },
    { service: "EX DEL BRANDED LDH UPS", zoningCountry: "AUSTRALIA" },
    {
      service: "EX DEL BRANDED JAL FEDEX SPCL CONT",
      zoningCountry: "AUSTRALIA",
    },
  ],
  CANADA: [
    { service: "EX DEL CAN YVR DDP", zipBased: true },
    { service: "EX DEL CAN YYZ DDP", zipBased: true },
    { service: "EX DEL BRANDED DHL DOX", zoningCountry: "CANADA" },
    { service: "EX DEL BRANDED DHL NDOX", zoningCountry: "CANADA" },
    { service: "EX DEL BRANDED UPS NDOX", zoningCountry: "CANADA" },
    { service: "EX DEL BRANDED FEDEX NDOX", zoningCountry: "CANADA" },
    { service: "EX DEL BRANDED LDH UPS", zoningCountry: "CANADA" },
    { service: "EX DEL BRANDED JAL FEDEX SPCL CONT", zoningCountry: "CANADA" },
  ],
  UK: [
    { service: "EX DEL PRE LHR UK DPD", zoningCountry: "UK" },
    { service: "EX DEL VIA LHR FEDEX IE", zoningCountry: "USA" },
    { service: "EX DEL BRANDED DHL DOX", zoningCountry: "UK" },
    { service: "EX DEL BRANDED DHL NDOX", zoningCountry: "UK" },
    { service: "EX DEL BRANDED UPS NDOX", zoningCountry: "UK" },
    { service: "EX DEL BRANDED LDH UPS", zoningCountry: "UK" },
  ],
  EUROPE: [
    { service: "EX DEL EUROPE DPD", zoningFromInput: true },
    { service: "EX DEL BRANDED DHL DOX", zoningFromInput: true },
    { service: "EX DEL BRANDED DHL NDOX", zoningFromInput: true },
    { service: "EX DEL BRANDED UPS NDOX", zoningFromInput: true },
    { service: "EX DEL BRANDED FEDEX NDOX", zoningFromInput: true },
    { service: "EX DEL BRANDED LDH UPS", zoningFromInput: true },
  ],
  INTERNATIONAL: [
    { service: "EX DEL ARAMEX-PPX-NDOX", zone: "1" },
    { service: "EX DEL ARAMEX-GPX-NDOX", zone: "1" },
    { service: "EX DEL BRANDED DHL DOX", zoningFromInput: true },
    { service: "EX DEL BRANDED DHL NDOX", zoningFromInput: true },
    { service: "EX DEL BRANDED UPS NDOX", zoningFromInput: true },
    { service: "EX DEL BRANDED FEDEX NDOX", zoningFromInput: true },
    { service: "EX DEL BRANDED LDH UPS", zoningFromInput: true },
    { service: "EX DEL BRANDED JAL FEDEX SPCL CONT", zoningFromInput: true },
    { service: "EX DEL BRANDED UPS DUTY FREE", zoningFromInput: true },
    { service: "EX DEL BRANDED FEDEX DUTY FREE", zoningFromInput: true },
  ],
};

function parseWalkinRates(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });

  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    if (
      String(raw[i]?.[0] || "")
        .trim()
        .toUpperCase() === "SHIPPER"
    ) {
      headerRowIdx = i;
      break;
    }
  }

  const headerRow = raw[headerRowIdx];
  const zoneCount = headerRow.length - 6;
  console.log(`[parseWalkinRates] Total zone columns: ${zoneCount}`);

  const rows = [];
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row[0]) continue;
    if (
      !row.some(
        (cell) =>
          cell !== null && cell !== undefined && String(cell).trim() !== "",
      )
    )
      continue;

    const shipper = String(row[0] || "").trim();
    const network = String(row[1] || "").trim();
    const service = String(row[2] || "").trim();
    const type = String(row[3] || "").trim();
    const minWt = parseFloat(row[4]);
    const maxWt = parseFloat(row[5]);

    if (
      !service ||
      !["S", "B", "D"].includes(type) ||
      isNaN(minWt) ||
      isNaN(maxWt)
    )
      continue;

    const zones = {};
    let hasValidZone = false;
    for (let z = 0; z < zoneCount; z++) {
      const val = row[6 + z];
      if (
        val !== null &&
        val !== undefined &&
        !isNaN(parseFloat(val)) &&
        parseFloat(val) > 0
      ) {
        zones[String(z + 1)] = Math.round(parseFloat(val) * 100) / 100;
        hasValidZone = true;
      }
    }

    if (hasValidZone)
      rows.push({ shipper, network, service, type, minWt, maxWt, zones });
  }

  console.log(`[parseWalkinRates] Parsed ${rows.length} rows`);
  return rows;
}

function parseZoningFile(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const rows = [];
  for (let i = 2; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row[0]) continue;
    const network = String(row[0] || "").trim();
    const service = String(row[1] || "").trim();
    const country = String(row[2] || "")
      .trim()
      .toUpperCase();
    const zone = String(parseInt(row[3]));
    if (!service || !country || zone === "NaN") continue;
    rows.push({
      network,
      service,
      country,
      zone,
      zipcode: country,
      city: "",
      state: "",
    });
  }
  return rows;
}

function parseZipCodes(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row[0]) continue;
    const network = String(row[0] || "").trim();
    const service = String(row[1] || "").trim();
    const country = String(row[2] || "")
      .trim()
      .toUpperCase();
    const zone = String(parseInt(row[3]));
    const zipcode = String(row[4] || "").trim();
    const city = String(row[5] || "").trim();
    const state = String(row[6] || "").trim();
    if (!service || !country || zone === "NaN" || !zipcode) continue;
    rows.push({ network, service, country, zone, zipcode, city, state });
  }
  return rows;
}

function estimateTat(service) {
  const s = service.toUpperCase();
  if (s.includes("AUS")) return "7–10 business days";
  if (s.includes("CAN")) return "8–12 business days";
  if (
    s.includes("UK") ||
    s.includes("LHR") ||
    s.includes("EUROPE") ||
    s.includes("DPD") ||
    s.includes("UPS")
  )
    return "5–8 business days";
  if (s.includes("DHL") || s.includes("FEDEX")) return "4–7 business days";
  if (s.includes("ARAMEX")) return "5–8 business days";
  return "5–10 business days";
}

fastify.post("/rates/upload", async (request, reply) => {
  try {
    const data = await request.file();
    if (!data)
      return reply
        .status(400)
        .send({ success: false, message: "No file uploaded" });

    const filename = data.filename;
    const chunks = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const lowerName = filename.toLowerCase();
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const peekSheet = workbook.Sheets[workbook.SheetNames[0]];
    const peekRaw = xlsx.utils.sheet_to_json(peekSheet, {
      header: 1,
      defval: null,
    });
    const headerRow = (peekRaw[0] || []).join(",").toUpperCase();
    const isZoningFile =
      (!headerRow.includes("SHIPPER") &&
        headerRow.includes("NETWORK") &&
        !headerRow.includes("ZIPCODE")) ||
      (peekRaw[1] || []).join(",").toUpperCase().includes("FORWARDER");

    let fileType;
    if (isZoningFile) fileType = "zipcodes";
    else if (lowerName.includes("zip")) fileType = "zipcodes";
    else fileType = "rates";

    const uploadId = uuidv4();
    await UploadLog.create({
      uploadId,
      filename,
      fileType,
      status: "processing",
      fileSize: buffer.length,
    });

    let rowsInserted = 0,
      rowsFailed = 0,
      deletedOld = 0,
      errorMessage;

    try {
      if (isZoningFile) {
        const rows = parseZoningFile(workbook);
        const delRes = await ZipZone.deleteMany({ zipcode: { $not: /^\d/ } });
        deletedOld = delRes.deletedCount || 0;
        const docs = rows.map((r) => ({ ...r, uploadId }));
        const res = await rawBulkInsert(ZipZone, docs);
        rowsInserted = res.inserted;
        rowsFailed = res.failed;
      } else if (fileType === "zipcodes") {
        const rows = parseZipCodes(workbook);
        const delRes = await ZipZone.deleteMany({ zipcode: { $regex: /^\d/ } });
        deletedOld = delRes.deletedCount || 0;
        const docs = rows.map((r) => ({ ...r, uploadId }));
        const res = await rawBulkInsert(ZipZone, docs);
        rowsInserted = res.inserted;
        rowsFailed = res.failed;
      } else {
        const rows = parseWalkinRates(workbook);
        const delRes = await WalkinRate.deleteMany({});
        deletedOld = delRes.deletedCount || 0;
        const docs = rows.map((r) => ({ ...r, uploadId }));
        const res = await rawBulkInsert(WalkinRate, docs);
        rowsInserted = res.inserted;
        rowsFailed = res.failed;
      }
    } catch (parseErr) {
      errorMessage = parseErr.message;
      rowsFailed = 1;
    }

    const status = errorMessage
      ? "failed"
      : rowsFailed > 0 && rowsInserted === 0
        ? "failed"
        : "completed";
    await UploadLog.findOneAndUpdate(
      { uploadId },
      { status, rowsInserted, rowsFailed, errorMessage },
    );

    apiCache.clear();

    return {
      success: status !== "failed",
      uploadId,
      fileType,
      deletedOld,
      rowsInserted,
      rowsFailed,
      message:
        status === "failed"
          ? `Upload failed: ${errorMessage || "No rows inserted"}`
          : `Uploaded successfully: ${deletedOld} old row(s) removed, ${rowsInserted} new record(s) inserted`,
    };
  } catch (error) {
    console.error("Rate upload error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/rates/uploads", async (request, reply) => {
  try {
    const logs = await UploadLog.find({})
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    return { success: true, data: logs };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/rates/services", async (request, reply) => {
  try {
    const rateServices = await WalkinRate.aggregate([
      {
        $group: {
          _id: { service: "$service", network: "$network" },
          minWt: { $min: "$minWt" },
          maxWt: { $max: "$maxWt" },
          slabs: { $sum: 1 },
        },
      },
    ]);
    const zipcodeServices = await ZipZone.distinct("service");
    return {
      success: true,
      data: {
        rateServices: rateServices.map((r) => ({
          service: r._id.service,
          network: r._id.network,
          minWt: r.minWt,
          maxWt: r.maxWt,
          slabs: r.slabs,
        })),
        zipcodeServices,
      },
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/rates/quote", async (request, reply) => {
  try {
    const actualWt = parseFloat(request.query.actualWt) || 0;
    const length = parseFloat(request.query.length) || 0;
    const breadth = parseFloat(request.query.breadth) || 0;
    const height = parseFloat(request.query.height) || 0;
    const country = String(request.query.country || "")
      .trim()
      .toUpperCase();
    const zipcode = String(request.query.zipcode || "")
      .trim()
      .toUpperCase();
    const zoningCountry = String(request.query.zoningCountry || "")
      .trim()
      .toUpperCase();

    if (!actualWt || !country) {
      return reply
        .status(400)
        .send({ success: false, message: "actualWt and country are required" });
    }

    const volWt =
      length && breadth && height ? (length * breadth * height) / 5000 : 0;
    const chargeableWt = Math.ceil(Math.max(actualWt, volWt));

    const ZIPCODE_COUNTRIES = ["AUSTRALIA", "CANADA"];
    if (ZIPCODE_COUNTRIES.includes(country) && !zipcode) {
      return reply.status(400).send({
        success: false,
        message: `Zipcode is required for ${country}`,
      });
    }

    const serviceList = SERVICE_DESTINATION_MAP[country];
    if (!serviceList) {
      return reply
        .status(400)
        .send({ success: false, message: `Unknown destination: ${country}` });
    }

    const results = [];

    for (const svc of serviceList) {
      try {
        let zone = null;

        if (svc.zone) {
          zone = svc.zone;
        } else if (svc.zipBased) {
          const cleanZip = zipcode.replace(/\s+/g, "");
          let zoneDoc = null;
          for (const tryZip of [
            cleanZip,
            cleanZip.slice(0, 4),
            cleanZip.slice(0, 3),
            cleanZip.slice(0, 1),
          ]) {
            if (!tryZip) continue;
            zoneDoc = await ZipZone.findOne({
              service: svc.service,
              zipcode: tryZip,
            }).lean();
            if (zoneDoc) break;
          }
          if (!zoneDoc) continue;
          zone = String(zoneDoc.zone);
        } else if (svc.zoningCountry) {
          const zoneDoc = await ZipZone.findOne({
            service: svc.service,
            zipcode: svc.zoningCountry,
          }).lean();
          if (!zoneDoc) continue;
          zone = String(zoneDoc.zone);
        } else if (svc.zoningFromInput) {
          const lookup = zoningCountry || country;
          const zoneDoc = await ZipZone.findOne({
            service: svc.service,
            zipcode: lookup,
          }).lean();
          if (!zoneDoc) continue;
          zone = String(zoneDoc.zone);
        }

        if (!zone) continue;

        const [rateDocS, rateDocB] = await Promise.all([
          WalkinRate.findOne({
            service: svc.service,
            type: "S",
            minWt: { $lte: chargeableWt },
            maxWt: { $gte: chargeableWt },
          })
            .sort({ createdAt: -1 })
            .lean(),
          WalkinRate.findOne({
            service: svc.service,
            type: "B",
            minWt: { $lte: chargeableWt },
            maxWt: { $gte: chargeableWt },
          })
            .sort({ createdAt: -1 })
            .lean(),
        ]);

        for (const rd of [rateDocS, rateDocB].filter(Boolean)) {
          const zoneMap =
            rd.zones instanceof Map ? Object.fromEntries(rd.zones) : rd.zones;
          const availableZoneKeys = zoneMap ? Object.keys(zoneMap) : [];

          let rawPrice = zoneMap?.[zone];

          if (
            (rawPrice === undefined || rawPrice === null || isNaN(rawPrice)) &&
            availableZoneKeys.length > 0
          ) {
            const firstVal = Object.values(zoneMap)[0];
            if (firstVal !== undefined && firstVal !== null && !isNaN(firstVal))
              rawPrice = firstVal;
          }

          if (rawPrice === undefined || rawPrice === null || isNaN(rawPrice))
            continue;

          const totalPrice =
            rd.type === "S"
              ? Math.round(rawPrice)
              : Math.round(rawPrice * chargeableWt);

          results.push({
            service: svc.service,
            network: rd.network,
            chargeableWt,
            actualWt,
            volWt: Math.round(volWt * 100) / 100,
            zone,
            rateType: rd.type,
            totalPrice,
            tat: estimateTat(svc.service),
          });
        }
      } catch (svcErr) {
        console.error(
          `[Quote Request] Quote error for service "${svc.service}":`,
          svcErr.message,
        );
      }
    }

    results.sort((a, b) => a.totalPrice - b.totalPrice);

    return {
      success: true,
      chargeableWt,
      actualWt,
      volWt: Math.round(volWt * 100) / 100,
      country,
      zipcode: zipcode || null,
      quotes: results,
    };
  } catch (error) {
    console.error("[Quote Request] Quote engine crash:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.delete("/rates/clear", async (request, reply) => {
  try {
    const type = String(request.query.type || "").trim();
    if (!["rates", "zipcodes"].includes(type)) {
      return reply.status(400).send({
        success: false,
        message: "Query param 'type' must be 'rates' or 'zipcodes'",
      });
    }
    const Model = type === "rates" ? WalkinRate : ZipZone;
    const result = await Model.deleteMany({});
    apiCache.clear();
    return {
      success: true,
      deletedCount: result.deletedCount || 0,
      message: `Deleted ${result.deletedCount || 0} ${type} record(s).`,
    };
  } catch (error) {
    console.error("Rates clear error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/rates/countries", async (request, reply) => {
  try {
    const cached = apiCache.get("rates-countries");
    if (cached) return { success: true, ...cached };

    const europeDpdCountries = await ZipZone.find(
      { service: "EX DEL EUROPE DPD" },
      { zipcode: 1, zone: 1, _id: 0 },
    ).lean();
    const intlCountries = await ZipZone.find(
      { service: "EX DEL BRANDED DHL NDOX" },
      { zipcode: 1, zone: 1, _id: 0 },
    ).lean();

    const data = {
      europe: europeDpdCountries.map((d) => d.zipcode).sort(),
      international: intlCountries.map((d) => d.zipcode).sort(),
    };
    apiCache.set("rates-countries", data, 3600);
    return { success: true, ...data };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============= BLOG CRUD OPERATIONS =============

async function seedBlogs() {
  try {
    const count = await Blog.countDocuments();
    if (count === 0) {
      console.log("🌱 Seeding initial blog posts...");
      await Blog.insertMany(INITIAL_BLOG_POSTS);
      console.log("🌱 Seeded initial blog posts successfully!");
    }
  } catch (error) {
    console.error("🌱 Seeding blog posts error:", error.message);
  }
}

fastify.get("/api/blogs", async (request, reply) => {
  try {
    const { category } = request.query;
    const cacheKey = `blogs_${category || "all"}`;
    const cached = apiCache.get(cacheKey);
    if (cached) return { success: true, data: cached };
    const filter = category && category !== "all" ? { category } : {};
    const blogs = await Blog.find(filter)
      .select("-content")
      .sort({ createdAt: -1 })
      .lean();
    apiCache.set(cacheKey, blogs, 1800);
    return { success: true, data: blogs };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/api/blogs/:slug", async (request, reply) => {
  try {
    const blog = await Blog.findOne({ slug: request.params.slug });
    if (!blog)
      return reply
        .status(404)
        .send({ success: false, message: "Blog not found" });
    return { success: true, data: blog };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/blogs", async (request, reply) => {
  try {
    const blogs = await Blog.find({}).sort({ createdAt: -1 });
    return { success: true, data: blogs };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/blogs/:id", async (request, reply) => {
  try {
    const blog = await Blog.findById(request.params.id);
    if (!blog)
      return reply
        .status(404)
        .send({ success: false, message: "Blog not found" });
    return { success: true, data: blog };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.post("/admin/blogs", async (request, reply) => {
  try {
    const blogData = request.body;
    if (!blogData.slug && blogData.title) {
      blogData.slug = blogData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
    }
    const blog = new Blog(blogData);
    await blog.save();
    apiCache.clear();
    return { success: true, data: blog, message: "Blog created successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.put("/admin/blogs/:id", async (request, reply) => {
  try {
    const blogData = request.body;
    if (!blogData.slug && blogData.title) {
      blogData.slug = blogData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
    }
    const blog = await Blog.findByIdAndUpdate(
      request.params.id,
      { ...blogData, updatedAt: new Date() },
      { new: true, runValidators: true },
    );
    if (!blog)
      return reply
        .status(404)
        .send({ success: false, message: "Blog not found" });
    apiCache.clear();
    return { success: true, data: blog, message: "Blog updated successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.delete("/admin/blogs/:id", async (request, reply) => {
  try {
    const blog = await Blog.findByIdAndDelete(request.params.id);
    if (!blog)
      return reply
        .status(404)
        .send({ success: false, message: "Blog not found" });
    apiCache.clear();
    return { success: true, message: "Blog deleted successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============= JOB CRUD OPERATIONS =============

fastify.get("/admin/jobs", async (request, reply) => {
  try {
    const { active } = request.query;
    const filter = active === "true" ? { isActive: true } : {};
    const jobs = await Job.find(filter).sort({ createdAt: -1 });
    return { success: true, data: jobs };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/jobs/:id", async (request, reply) => {
  try {
    const job = await Job.findById(request.params.id);
    if (!job)
      return reply
        .status(404)
        .send({ success: false, message: "Job not found" });
    return { success: true, data: job };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.post("/admin/jobs", async (request, reply) => {
  try {
    const job = new Job(request.body);
    await job.save();
    return { success: true, data: job, message: "Job created successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.put("/admin/jobs/:id", async (request, reply) => {
  try {
    const job = await Job.findByIdAndUpdate(
      request.params.id,
      { ...request.body, updatedAt: new Date() },
      { new: true, runValidators: true },
    );
    if (!job)
      return reply
        .status(404)
        .send({ success: false, message: "Job not found" });
    return { success: true, data: job, message: "Job updated successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.delete("/admin/jobs/:id", async (request, reply) => {
  try {
    const job = await Job.findByIdAndDelete(request.params.id);
    if (!job)
      return reply
        .status(404)
        .send({ success: false, message: "Job not found" });
    return { success: true, message: "Job deleted successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============= JOB APPLICATION ROUTES =============

fastify.get("/admin/applications", async (request, reply) => {
  try {
    const { jobId, status } = request.query;
    const filter = {};
    if (jobId) filter.jobId = jobId;
    if (status) filter.status = status;
    const applications = await JobApplication.find(filter)
      .sort({ createdAt: -1 })
      .populate("jobId", "title department location");
    return { success: true, data: applications };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/applications/:id", async (request, reply) => {
  try {
    const application = await JobApplication.findById(
      request.params.id,
    ).populate("jobId", "title department location");
    if (!application)
      return reply
        .status(404)
        .send({ success: false, message: "Application not found" });
    return { success: true, data: application };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.put("/admin/applications/:id", async (request, reply) => {
  try {
    const { status, notes } = request.body;
    const application = await JobApplication.findByIdAndUpdate(
      request.params.id,
      { status, notes, updatedAt: new Date() },
      { new: true },
    );
    if (!application)
      return reply
        .status(404)
        .send({ success: false, message: "Application not found" });
    return {
      success: true,
      data: application,
      message: "Application updated successfully",
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/download-resume/:applicationId", async (request, reply) => {
  try {
    const application = await JobApplication.findById(
      request.params.applicationId,
    );
    if (!application)
      return reply
        .status(404)
        .send({ success: false, message: "Application not found" });

    let fileBuffer = null;
    const fileName = `${application.fullName.replace(/\s+/g, "_")}_Resume.pdf`;

    try {
      const directUrl = `${application.resumeUrl}?fl_attachment=1&raw=1`;
      const response = await fetch(directUrl, {
        method: "GET",
        headers: {
          Accept: "application/pdf, application/octet-stream, */*",
          "User-Agent": "Mozilla/5.0",
        },
      });

      if (response.ok) {
        fileBuffer = Buffer.from(await response.arrayBuffer());
      } else {
        const timestamp = Math.floor(Date.now() / 1000) + 300;
        const publicId = application.resumePublicId;
        const signatureString = `public_id=${publicId}&timestamp=${timestamp}`;
        const signature = crypto
          .createHmac("sha256", process.env.CLOUDINARY_API_SECRET)
          .update(signatureString)
          .digest("hex");
        const signedUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/${publicId}?timestamp=${timestamp}&signature=${signature}&api_key=${process.env.CLOUDINARY_API_KEY}&fl_attachment=1`;
        const signedResponse = await fetch(signedUrl, {
          method: "GET",
          headers: {
            Accept: "application/pdf, application/octet-stream, */*",
            "User-Agent": "Mozilla/5.0",
          },
        });

        if (signedResponse.ok) {
          fileBuffer = Buffer.from(await signedResponse.arrayBuffer());
        } else {
          const apiUrl = `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/resources/raw/upload/${publicId}`;
          const authString = Buffer.from(
            `${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`,
          ).toString("base64");
          const apiResponse = await fetch(apiUrl, {
            method: "GET",
            headers: {
              Authorization: `Basic ${authString}`,
              Accept: "application/json",
            },
          });

          if (apiResponse.ok) {
            const resourceData = await apiResponse.json();
            const downloadResponse = await fetch(resourceData.secure_url, {
              method: "GET",
              headers: {
                Accept: "application/pdf, application/octet-stream, */*",
                "User-Agent": "Mozilla/5.0",
              },
            });
            if (downloadResponse.ok) {
              fileBuffer = Buffer.from(await downloadResponse.arrayBuffer());
            } else {
              throw new Error(
                `API download failed: ${downloadResponse.status}`,
              );
            }
          } else {
            const lastResponse = await fetch(application.resumeUrl, {
              method: "GET",
              headers: {
                Accept: "application/pdf, application/octet-stream, */*",
                "User-Agent": "Mozilla/5.0",
              },
            });
            if (lastResponse.ok) {
              fileBuffer = Buffer.from(await lastResponse.arrayBuffer());
            } else {
              throw new Error(
                `All methods failed. Last status: ${lastResponse.status}`,
              );
            }
          }
        }
      }
    } catch (fetchError) {
      throw new Error(`Could not download file: ${fetchError.message}`);
    }

    if (!fileBuffer || fileBuffer.length === 0)
      throw new Error("Downloaded file is empty");

    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename="${fileName}"`);
    reply.header("Content-Length", fileBuffer.length);
    reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");

    return reply.send(fileBuffer);
  } catch (error) {
    console.error("❌ Resume download error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Failed to download resume. Please try again.",
    });
  }
});

fastify.post("/api/jobs/apply", async (request, reply) => {
  try {
    const data = await request.file();
    if (!data)
      return reply
        .status(400)
        .send({ success: false, message: "No file uploaded" });

    const fields = {};
    for (const [key, value] of Object.entries(data.fields))
      fields[key] = value.value;

    const { jobId, fullName, email, phone, experience, noticePeriod } = fields;

    if (!jobId || !fullName || !email || !experience || !noticePeriod) {
      return reply
        .status(400)
        .send({ success: false, message: "Missing required fields" });
    }

    const job = await Job.findById(jobId);
    if (!job)
      return reply
        .status(404)
        .send({ success: false, message: "Job not found" });

    const chunks = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    let cloudinaryResult;
    try {
      cloudinaryResult = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              resource_type: "raw",
              folder: "manvi-resumes",
              public_id: `${email.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`,
              access_mode: "public",
              use_filename: true,
              unique_filename: false,
              invalidate: true,
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            },
          )
          .end(buffer);
      });
    } catch (cloudinaryError) {
      return reply.status(500).send({
        success: false,
        message: "Failed to upload resume. Please try again.",
      });
    }

    const application = new JobApplication({
      jobId,
      jobTitle: job.title,
      fullName,
      email,
      phone: phone || "N/A",
      experience,
      noticePeriod,
      resumeUrl: cloudinaryResult.secure_url,
      resumePublicId: cloudinaryResult.public_id,
    });
    await application.save();

    let emailErrors = [];

    try {
      const adminEmailHtml = `
        <h2>New Job Application Received</h2>
        <p><strong>Position:</strong> ${job.title}</p>
        <p><strong>Department:</strong> ${job.department}</p>
        <p><strong>Applicant:</strong> ${fullName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || "N/A"}</p>
        <p><strong>Experience:</strong> ${experience}</p>
        <p><strong>Notice Period:</strong> ${noticePeriod}</p>
        <p><strong>Resume:</strong> <a href="${cloudinaryResult.secure_url}">View Resume</a></p>
        <p><strong>Applied at:</strong> ${new Date().toLocaleString()}</p>
        <hr /><p>View all applications in the admin panel.</p>`;
      const adminEmailResult = await sendEmail(
        "harmanjeet.singh@iic.ac.in",
        `New Job Application: ${job.title} - ${fullName}`,
        adminEmailHtml,
      );
      if (!adminEmailResult.success)
        emailErrors.push("Admin notification failed");
    } catch (emailError) {
      emailErrors.push("Admin notification failed");
    }

    try {
      const confirmationHtml = `
        <h2>Thank you for applying at Manvi International</h2>
        <p>Dear ${fullName},</p>
        <p>We have received your application for the position of <strong>${job.title}</strong>.</p>
        <p>Our team will review your application and get back to you shortly.</p><br />
        <p><strong>Application Summary:</strong></p>
        <ul><li><strong>Position:</strong> ${job.title}</li><li><strong>Department:</strong> ${job.department}</li><li><strong>Location:</strong> ${job.location}</li><li><strong>Experience:</strong> ${experience}</li><li><strong>Notice Period:</strong> ${noticePeriod}</li></ul><br />
        <p>Best regards,</p><p><strong>Manvi International Team</strong></p>
        <p><small>This is an automated confirmation. Please do not reply to this email.</small></p>`;
      const applicantEmailResult = await sendEmail(
        email,
        `Application Received: ${job.title} - Manvi International`,
        confirmationHtml,
      );
      if (!applicantEmailResult.success)
        emailErrors.push("Applicant confirmation failed");
    } catch (emailError) {
      emailErrors.push("Applicant confirmation failed");
    }

    return {
      success: true,
      message:
        "Application submitted successfully! We'll review your application and get back to you soon.",
      applicationId: application._id,
      emailErrors: emailErrors.length > 0 ? emailErrors : undefined,
    };
  } catch (error) {
    console.error("Application submission error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Failed to submit application",
    });
  }
});

fastify.post("/api/jobs/apply-speculative", async (request, reply) => {
  try {
    const data = await request.file();
    if (!data)
      return reply
        .status(400)
        .send({ success: false, message: "No file uploaded" });

    const fields = {};
    for (const [key, value] of Object.entries(data.fields))
      fields[key] = value.value;

    const { fullName, email, phone, experience, noticePeriod, message } =
      fields;

    if (!fullName || !email || !experience || !noticePeriod) {
      return reply
        .status(400)
        .send({ success: false, message: "Missing required fields" });
    }

    const chunks = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    let cloudinaryResult;
    try {
      cloudinaryResult = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              resource_type: "raw",
              folder: "manvi-resumes",
              public_id: `speculative_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`,
              access_mode: "public",
              use_filename: true,
              unique_filename: false,
              invalidate: true,
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            },
          )
          .end(buffer);
      });
    } catch (cloudinaryError) {
      return reply.status(500).send({
        success: false,
        message: "Failed to upload resume. Please try again.",
      });
    }

    const application = new JobApplication({
      jobId: null,
      jobTitle: "Speculative Application",
      fullName,
      email,
      phone: phone || "N/A",
      experience,
      noticePeriod,
      resumeUrl: cloudinaryResult.secure_url,
      resumePublicId: cloudinaryResult.public_id,
      status: "pending",
      notes: message || "Speculative application - no specific role",
    });
    await application.save();

    try {
      const adminEmailHtml = `
        <h2>New Speculative Application Received</h2>
        <p><strong>Applicant:</strong> ${fullName}</p><p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || "N/A"}</p><p><strong>Experience:</strong> ${experience}</p>
        <p><strong>Notice Period:</strong> ${noticePeriod}</p>
        ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
        <p><strong>Resume:</strong> <a href="${cloudinaryResult.secure_url}">View Resume</a></p>
        <p><strong>Applied at:</strong> ${new Date().toLocaleString()}</p><hr />
        <p>This is a speculative application. No specific role was applied for.</p>`;
      await sendEmail(
        "harmanjeet.singh@iic.ac.in",
        `New Speculative Application - ${fullName}`,
        adminEmailHtml,
      );
    } catch (emailError) {}

    try {
      const confirmationHtml = `
        <h2>Thank you for your interest in Manvi International</h2>
        <p>Dear ${fullName},</p><p>We have received your speculative application.</p>
        <p>Our team will review your profile and get back to you if we find a suitable position.</p><br />
        <p>Best regards,</p><p><strong>Manvi International Team</strong></p>`;
      await sendEmail(
        email,
        `Application Received - Manvi International`,
        confirmationHtml,
      );
    } catch (emailError) {}

    return {
      success: true,
      message:
        "Application submitted successfully! We'll review your profile and get back to you soon.",
      applicationId: application._id,
    };
  } catch (error) {
    console.error("Speculative application submission error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Failed to submit application",
    });
  }
});

fastify.get("/admin/applications/stats", async (request, reply) => {
  try {
    const total = await JobApplication.countDocuments();
    const pending = await JobApplication.countDocuments({ status: "pending" });
    const reviewed = await JobApplication.countDocuments({
      status: "reviewed",
    });
    const shortlisted = await JobApplication.countDocuments({
      status: "shortlisted",
    });
    const rejected = await JobApplication.countDocuments({
      status: "rejected",
    });
    return {
      success: true,
      data: { total, pending, reviewed, shortlisted, rejected },
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.post("/admin/upload-image", async (request, reply) => {
  try {
    const data = await request.file();
    if (!data)
      return reply
        .status(400)
        .send({ success: false, message: "No file uploaded" });

    const chunks = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    let cloudinaryResult;
    try {
      cloudinaryResult = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder: "manvi-blog-images",
              resource_type: "image",
              access_mode: "public",
              invalidate: true,
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            },
          )
          .end(buffer);
      });
    } catch (cloudinaryError) {
      return reply.status(500).send({
        success: false,
        message: "Failed to upload image to Cloudinary",
      });
    }

    return {
      success: true,
      url: cloudinaryResult.secure_url,
      message: "Image uploaded successfully",
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============================================================
// QUOTE ENQUIRY ROUTES
// ============================================================

fastify.post(
  "/quote-enquiries",
  { config: { rateLimit: { max: 50, timeWindow: "1 minute" } } },
  async (request, reply) => {
    try {
      const {
        name,
        phone,
        email,
        destination,
        zoningCountry,
        zipcode,
        actualWt,
        volWt,
        chargeableWt,
        length,
        breadth,
        height,
        service,
        network,
        zone,
        rateType,
        totalPrice,
        tat,
      } = request.body;

      if (!name || !phone || !email || !destination || !service) {
        return reply
          .status(400)
          .send({ success: false, message: "Missing required fields" });
      }

      const enquiry = new QuoteEnquiry({
        name,
        phone,
        email,
        destination,
        zoningCountry: zoningCountry || "",
        zipcode: zipcode || "",
        actualWt: parseFloat(actualWt) || 0,
        volWt: parseFloat(volWt) || 0,
        chargeableWt: parseFloat(chargeableWt) || 0,
        length: parseFloat(length) || 0,
        breadth: parseFloat(breadth) || 0,
        height: parseFloat(height) || 0,
        service,
        network: network || "",
        zone: zone || "",
        rateType: rateType || "",
        totalPrice: parseFloat(totalPrice) || 0,
        tat: tat || "",
      });

      await enquiry.save();

      try {
        const zohoData = new URLSearchParams();
        zohoData.append(
          "xnQsjsdp",
          "2fad6954b8023f2fbc4bdc7e2dbc0549a65d76d011e243b729db9929cdf08ce1",
        );
        zohoData.append("zc_gad", "");
        zohoData.append(
          "xmIwtLD",
          "1a9629a986c6048e743fa215eca9f3fac90c7ae16024a68577844e1ff3d6ff263ea9a377fc6c5c394df6f32322f1ab2a",
        );
        zohoData.append("actionType", "TGVhZHM=");
        zohoData.append("returnURL", "null");

        const nameParts = (name || "Unknown").trim().split(" ");
        const lastName = nameParts.length > 1 ? nameParts.pop() : nameParts[0];
        const firstName = nameParts.length > 1 ? nameParts.join(" ") : "";

        zohoData.append("Last Name", lastName);
        if (firstName) zohoData.append("First Name", firstName);
        if (email) zohoData.append("Email", email);
        if (phone) zohoData.append("Phone", phone);
        zohoData.append("Designation", service || "");
        zohoData.append("Website", chargeableWt ? chargeableWt.toString() : "");
        zohoData.append("Company", totalPrice ? totalPrice.toString() : "0");
        const desc = `Destination: ${destination || "N/A"}\nActual Wt: ${actualWt}\nVol Wt: ${volWt}\nDimensions: ${length}x${breadth}x${height}\nZipcode: ${zipcode || "N/A"}`;
        zohoData.append("Description", desc);
        zohoData.append("Lead Source", "Web Download");

        await fetch("https://crm.zoho.in/crm/WebToLeadForm", {
          method: "POST",
          body: zohoData,
        });
      } catch (zohoError) {
        console.error("Failed to send quote enquiry to Zoho CRM:", zohoError);
      }

      return reply.send({ success: true, enquiry });
    } catch (error) {
      console.error("QuoteEnquiry submission error:", error);
      return reply.status(500).send({ success: false, message: error.message });
    }
  },
);

// ============================================================
// MANVI COURIER SHIPMENT API ROUTES
// ============================================================

fastify.post("/shipment/order-create", async (request, reply) => {
  try {
    const payload = request.body;

    if (!payload.Awbno) {
      const timestamp = Date.now().toString().slice(-8);
      const randomDigit = Math.floor(100 + Math.random() * 900);
      payload.Awbno = `AWB${timestamp}${randomDigit}`;
    }

    const response = await fetch(
      "http://api.manvicourier.com/api/shipment/order_create",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const manviResult = await response.json().catch(() => ({ Status: true }));

    try {
      const enquiry = new QuoteEnquiry({
        name:
          payload.Sender?.SenderName ||
          payload.Sender?.SenderContactPerson ||
          "Customer",
        phone: payload.Sender?.SenderTelephone || "",
        email: payload.Sender?.SenderEmailId || "",
        destination: payload.Receiver?.ReceiverCountry || "INTERNATIONAL",
        zoningCountry: payload.Receiver?.ReceiverCity || "",
        zipcode: payload.Receiver?.ReceiverZipcode || "",
        actualWt: payload.PackageDetails?.PackageDetail?.[0]?.ActualWeight || 0,
        volWt: 0,
        chargeableWt:
          payload.PackageDetails?.PackageDetail?.[0]?.ActualWeight || 0,
        service: payload.ServiceDetails?.ServiceName || "Express",
        network: payload.ServiceDetails?.NetworkCode || "DHL",
        totalPrice: payload.FreightDetails?.NetTotal || 0,
        status: "BOOKED",
        notes: `AWB: ${payload.Awbno} | Manvi API Response: ${JSON.stringify(manviResult)}`,
      });
      await enquiry.save();
    } catch (dbErr) {
      console.error("Failed to save shipment to QuoteEnquiry:", dbErr.message);
    }

    try {
      await Shipment.findOneAndUpdate(
        { awbNo: payload.Awbno },
        {
          $setOnInsert: {
            awbNo: payload.Awbno,
            accountCode: payload.AccountCode || "GUEST",
            customerName:
              payload.Sender?.SenderName ||
              payload.Sender?.SenderContactPerson ||
              "Customer",
            destination: payload.Receiver?.ReceiverCountry || "INTERNATIONAL",
            shipper: payload.Sender,
            receiver: payload.Receiver,
            service: payload.ServiceDetails?.ServiceName || "Express",
            network: payload.ServiceDetails?.NetworkCode || "DHL",
            chargeableWt:
              payload.PackageDetails?.PackageDetail?.[0]?.ActualWeight || 0,
            invoiceNo: payload.AdditionalDetails?.InvoiceNo || "",
            invoiceDate: payload.AdditionalDetails?.InvoiceDate || new Date(),
            products: (payload.AdditionalDetails?.ProductDetails || []).map(
              (p, idx) => ({
                boxNo: p.BoxNo || String(idx + 1),
                description: p.Description || "",
                hsnCode: p.HSNCode || "",
                unitType: p.UnitType || "PCS",
                qty: p.Qty || 1,
                unitRate: p.UnitRate || 0,
                pieceWt: p.PieceWt || 0,
              }),
            ),
            basicAmt: payload.FreightDetails?.BasicAmount || 0,
            cgstAmt: payload.FreightDetails?.CGST || 0,
            sgstAmt: payload.FreightDetails?.SGST || 0,
            igstAmt: payload.FreightDetails?.IGST || 0,
            totalAmt: payload.FreightDetails?.NetTotal || 0,
            status: "BOOKED",
            source: "Website",
            manviResponse: manviResult,
            events: [
              {
                eventDescription: "Order Confirmed",
                location: payload.Receiver?.ReceiverCountry || "",
              },
            ],
          },
        },
        { upsert: true, new: true },
      );
    } catch (dbErr) {
      console.error("Failed to upsert Shipment record:", dbErr.message);
    }

    return reply.send({
      success: true,
      awbno: payload.Awbno,
      data: manviResult,
    });
  } catch (error) {
    console.error("MANVI Order Create error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.post("/shipment/order-update", async (request, reply) => {
  try {
    const payload = request.body;

    if (!payload.Awbno) {
      return reply.status(400).send({
        success: false,
        message: "Awbno is required for update",
      });
    }

    console.log(`[Manvi API] Updating shipment: ${payload.Awbno}`);

    const manviRes = await fetch(
      "http://api.manvicourier.com/api/shipment/order_update",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const manviResult = await manviRes.json().catch(() => ({ Status: true }));

    console.log(
      `[Manvi API] Update response:`,
      JSON.stringify(manviResult, null, 2),
    );

    if (manviResult.Status === true) {
      try {
        const updateData = {};

        if (payload.Receiver) {
          updateData.receiver = {
            receiverName: payload.Receiver.ReceiverName,
            receiverPhone: payload.Receiver.ReceiverTelephone || "",
            receiverEmail: payload.Receiver.ReceiverEmailid || "",
            receiverAddress: payload.Receiver.ReceiverAddressLine1 || "",
            receiverCity: payload.Receiver.ReceiverCity || "",
            receiverState: payload.Receiver.ReceiverState || "",
            receiverZipcode: payload.Receiver.ReceiverZipcode || "",
            receiverCountry: payload.Receiver.ReceiverCountry || "",
          };
        }

        if (payload.Sender) {
          updateData.shipper = {
            shipperName: payload.Sender.SenderName || "",
            shipperPhone: payload.Sender.SenderTelephone || "",
            shipperEmail: payload.Sender.SenderEmailId || "",
            shipperAddress: payload.Sender.SenderAddressLine1 || "",
            shipperCity: payload.Sender.SenderCity || "",
            shipperState: payload.Sender.SenderState || "",
            shipperPincode: payload.Sender.SenderPincode || "",
          };
        }

        if (payload.FreightDetails) {
          updateData.basicAmt = payload.FreightDetails.BasicAmount || 0;
          updateData.cgstAmt = payload.FreightDetails.CGST || 0;
          updateData.sgstAmt = payload.FreightDetails.SGST || 0;
          updateData.igstAmt = payload.FreightDetails.IGST || 0;
          updateData.totalAmt = payload.FreightDetails.NetTotal || 0;
        }

        if (payload.AdditionalDetails) {
          updateData.invoiceNo = payload.AdditionalDetails.InvoiceNo || "";
          updateData.invoiceDate =
            payload.AdditionalDetails.InvoiceDate || new Date();
          updateData.termsOfSale = payload.AdditionalDetails.TermsOfSale || "";
          updateData.reasonForExport =
            payload.AdditionalDetails.ReasonForExport || "";
        }

        if (payload.ServiceDetails) {
          updateData.service = payload.ServiceDetails.ServiceName || "";
          updateData.network = payload.ServiceDetails.NetworkCode || "";
        }

        updateData.$push = {
          events: {
            eventDescription: "Shipment Updated",
            eventDate: new Date(),
            location: payload.Receiver?.ReceiverCountry || "",
          },
        };

        const updatedShipment = await Shipment.findOneAndUpdate(
          { awbNo: payload.Awbno },
          updateData,
          { new: true, runValidators: true },
        );

        if (updatedShipment) {
          console.log(`[Manvi API] Local shipment updated: ${payload.Awbno}`);
        }
      } catch (dbErr) {
        console.error("Failed to update local shipment record:", dbErr.message);
      }
    }

    return reply.send({
      success: manviResult.Status === true,
      awbno: payload.Awbno,
      data: manviResult,
      message:
        manviResult.Status === true
          ? "Shipment updated successfully"
          : "Update failed",
    });
  } catch (error) {
    console.error("MANVI Order Update error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.post("/shipment/event-push", async (request, reply) => {
  try {
    const payload = request.body;

    if (!payload.Awbno) {
      return reply.status(400).send({
        success: false,
        message: "Awbno is required for event push",
      });
    }

    if (!payload.EventCode || !payload.EventDescription) {
      return reply.status(400).send({
        success: false,
        message: "EventCode and EventDescription are required",
      });
    }

    console.log(`[Manvi API] Pushing event for shipment: ${payload.Awbno}`);
    console.log(
      `[Manvi API] Event: ${payload.EventCode} - ${payload.EventDescription}`,
    );

    if (payload.EventDate) {
      if (payload.EventDate.length === 10 && payload.EventDate.includes("-")) {
        const time = payload.EventTime || "00:00:00";
        payload.EventDate = `${payload.EventDate}T${time}`;
      }
    } else {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      payload.EventDate = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    }

    const manviRes = await fetch(
      "http://api.manvicourier.com/api/shipment/event_push",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const manviResult = await manviRes.json().catch(() => ({ Status: true }));

    console.log(
      `[Manvi API] Event push response:`,
      JSON.stringify(manviResult, null, 2),
    );

    if (manviResult.Status === true) {
      try {
        const eventData = {
          eventCode: payload.EventCode || "",
          eventDescription: payload.EventDescription || "Event pushed",
          eventDate: payload.EventDate
            ? new Date(payload.EventDate)
            : new Date(),
          eventTime: payload.EventTime || "",
          location: payload.Location || "",
        };

        const updateData = {
          $push: { events: eventData },
        };

        if (payload.EventCode === "DL") {
          updateData.status = "DELIVERED";
        } else if (payload.EventCode === "CN") {
          updateData.status = "CANCELLED";
        }

        const updatedShipment = await Shipment.findOneAndUpdate(
          { awbNo: payload.Awbno },
          updateData,
          { new: true, runValidators: true },
        );

        if (updatedShipment) {
          console.log(
            `[Manvi API] Local shipment event added: ${payload.Awbno}`,
          );
        } else {
          console.log(`[Manvi API] Local shipment not found: ${payload.Awbno}`);
        }
      } catch (dbErr) {
        console.error("Failed to update local shipment record:", dbErr.message);
      }
    }

    return reply.send({
      success: manviResult.Status === true,
      awbno: payload.Awbno,
      data: manviResult,
      message:
        manviResult.Status === true
          ? "Event pushed successfully"
          : "Event push failed",
    });
  } catch (error) {
    console.error("MANVI Event Push error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/shipment/tracking/:awb", async (request, reply) => {
  const { awb } = request.params;
  try {
    const response = await fetch(
      `http://api.manvicourier.com/api/gettracking/${awb}`,
      { headers: { "Content-Type": "application/json" } },
    );
    const data = await response.json();
    if (data?.Status && data?.Data) return reply.send(data);
    throw new Error("External tracking returned no data");
  } catch (externalErr) {
    try {
      const shipment = await Shipment.findOne({ awbNo: awb }).lean();
      if (!shipment) {
        return reply.send({
          Status: false,
          Data: { ErrorMessage: "Tracking details not found" },
        });
      }
      const events = [...(shipment.events || [])]
        .sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate))
        .map((e) => ({
          EventCode: e.eventCode || "",
          EventDescription: e.eventDescription,
          EventDate: e.eventDate,
          EventTime: e.eventTime || "",
          Location: e.location || "",
        }));
      return reply.send({
        Status: true,
        Data: {
          Awbno: shipment.awbNo,
          Destination: shipment.destination,
          Shipdate: shipment.createdAt,
          ForwardingNo: shipment.forwardingNo || "",
          Forwarder: shipment.forwarder || shipment.network || "",
          Consignee:
            shipment.receiver?.receiverName ||
            shipment.receiver?.ReceiverName ||
            "",
          Events: events,
        },
      });
    } catch (localErr) {
      console.error(
        "MANVI Tracking error:",
        externalErr.message,
        localErr.message,
      );
      return reply.status(500).send({
        Status: false,
        Data: { ErrorMessage: "Unable to fetch tracking details" },
      });
    }
  }
});

// ============================================================
// SERVICE AREA ROUTES
// ============================================================

fastify.get("/service-areas/search", async (request, reply) => {
  try {
    const q = String(request.query.q || "").trim();
    if (!q)
      return reply
        .status(400)
        .send({ success: false, message: "Query parameter 'q' is required" });
    const regex = new RegExp(q, "i");
    const areas = await ServiceArea.find({
      isActive: true,
      $or: [{ city: regex }, { state: regex }, { pincode: regex }],
    })
      .select("-__v -createdAt -updatedAt")
      .limit(20)
      .lean();
    return { success: true, data: areas, count: areas.length };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/service-areas", async (request, reply) => {
  try {
    const cached = apiCache.get("service-areas-public");
    if (cached) return { success: true, data: cached };
    const areas = await ServiceArea.find({ isActive: true })
      .sort({ country: 1, state: 1, city: 1 })
      .select("-__v")
      .lean();
    apiCache.set("service-areas-public", areas, 600);
    return { success: true, data: areas };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/service-areas", async (request, reply) => {
  try {
    const { active, country } = request.query;
    const filter = {};
    if (active === "true") filter.isActive = true;
    if (active === "false") filter.isActive = false;
    if (country) filter.country = new RegExp(country, "i");
    const areas = await ServiceArea.find(filter)
      .sort({ country: 1, state: 1, city: 1 })
      .lean();
    return { success: true, data: areas, total: areas.length };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/service-areas/:id", async (request, reply) => {
  try {
    const area = await ServiceArea.findById(request.params.id).lean();
    if (!area)
      return reply
        .status(404)
        .send({ success: false, message: "Service area not found" });
    return { success: true, data: area };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.post("/admin/service-areas", async (request, reply) => {
  try {
    const area = new ServiceArea(request.body);
    await area.save();
    apiCache.clear("service-areas-public");
    return {
      success: true,
      data: area,
      message: "Service area created successfully",
    };
  } catch (error) {
    if (error.code === 11000) {
      return reply.status(409).send({
        success: false,
        message: "A service area with this city/pincode already exists",
      });
    }
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.put("/admin/service-areas/:id", async (request, reply) => {
  try {
    const area = await ServiceArea.findByIdAndUpdate(
      request.params.id,
      { ...request.body, updatedAt: new Date() },
      { new: true, runValidators: true },
    ).lean();
    if (!area)
      return reply
        .status(404)
        .send({ success: false, message: "Service area not found" });
    apiCache.clear("service-areas-public");
    return {
      success: true,
      data: area,
      message: "Service area updated successfully",
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.delete("/admin/service-areas/:id", async (request, reply) => {
  try {
    const area = await ServiceArea.findByIdAndDelete(request.params.id);
    if (!area)
      return reply
        .status(404)
        .send({ success: false, message: "Service area not found" });
    apiCache.clear("service-areas-public");
    return { success: true, message: "Service area deleted successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.put("/admin/service-areas/:id/toggle", async (request, reply) => {
  try {
    const area = await ServiceArea.findById(request.params.id);
    if (!area)
      return reply
        .status(404)
        .send({ success: false, message: "Service area not found" });
    area.isActive = !area.isActive;
    await area.save();
    apiCache.clear("service-areas-public");
    return {
      success: true,
      data: area,
      message: `Service area ${area.isActive ? "activated" : "deactivated"}`,
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/service-areas/stats", async (request, reply) => {
  try {
    const [total, active, pickupOnly, dropoffOnly, both] = await Promise.all([
      ServiceArea.countDocuments(),
      ServiceArea.countDocuments({ isActive: true }),
      ServiceArea.countDocuments({
        isActive: true,
        pickupAvailable: true,
        dropoffAvailable: false,
      }),
      ServiceArea.countDocuments({
        isActive: true,
        pickupAvailable: false,
        dropoffAvailable: true,
      }),
      ServiceArea.countDocuments({
        isActive: true,
        pickupAvailable: true,
        dropoffAvailable: true,
      }),
    ]);
    return {
      success: true,
      data: { total, active, pickupOnly, dropoffOnly, both },
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============================================================
// CUSTOMER PORTAL — REGISTRATION / LOGIN / APPROVAL
// ============================================================

function generateCustomerId() {
  return `M5C-CUST-${Math.floor(100000 + Math.random() * 900000)}`;
}

fastify.post(
  "/customer/register",
  { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
  async (request, reply) => {
    try {
      const { name, email, phone, company, address, gstin, password } =
        request.body;
      if (!name || !email || !phone || !password) {
        return reply.status(400).send({
          success: false,
          message: "Name, email, phone and password are required",
        });
      }
      const existing = await Customer.findOne({
        email: email.toLowerCase().trim(),
      });
      if (existing) {
        return reply.status(400).send({
          success: false,
          message: "Email address is already registered.",
        });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const customer = await Customer.create({
        customerId: generateCustomerId(),
        name,
        email: email.toLowerCase().trim(),
        phone,
        company: company || "N/A",
        address: address || "",
        gstin: gstin || "N/A",
        passwordHash,
        status: "PENDING",
        balance: 50000,
      });

      sendEmail(
        email,
        "Registration Received - Manvi International",
        `<p>Hi ${name},</p><p>Your customer portal registration has been received and is pending admin approval. You'll be notified once approved.</p>`,
      ).catch(() => {});

      return reply.send({
        success: true,
        message: "Registration submitted successfully! Pending admin approval.",
        customer: {
          id: customer.customerId,
          name: customer.name,
          email: customer.email,
          status: customer.status,
        },
      });
    } catch (error) {
      if (error.code === 11000) {
        return reply.status(400).send({
          success: false,
          message: "Email address is already registered.",
        });
      }
      return reply.status(500).send({ success: false, message: error.message });
    }
  },
);

fastify.post("/customer/login", async (request, reply) => {
  try {
    const { email, password } = request.body;
    if (!email || !password) {
      return reply
        .status(400)
        .send({ success: false, message: "Email and password are required" });
    }
    const customer = await Customer.findOne({
      email: email.toLowerCase().trim(),
    });
    if (!customer) {
      return reply.status(404).send({
        success: false,
        message: "User account not found. Please register first.",
      });
    }
    const match = await bcrypt.compare(password, customer.passwordHash);
    if (!match) {
      return reply
        .status(401)
        .send({ success: false, message: "Invalid email or password." });
    }
    if (customer.status !== "APPROVED") {
      return reply.status(403).send({
        success: false,
        message: `Account status is ${customer.status}. Admin approval is required before logging in.`,
        status: customer.status,
      });
    }
    return reply.send({
      success: true,
      message: "Login successful",
      customer: {
        id: customer.customerId,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        company: customer.company,
        gstin: customer.gstin,
        address: customer.address,
        status: customer.status,
        balance: customer.balance,
      },
    });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/customers", async (request, reply) => {
  try {
    const { status } = request.query;
    const filter = status && status !== "ALL" ? { status } : {};
    const customers = await Customer.find(filter)
      .sort({ createdAt: -1 })
      .select("-passwordHash")
      .lean();
    return {
      success: true,
      data: customers.map((c) => ({ ...c, id: c.customerId })),
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/customers/stats", async (request, reply) => {
  try {
    const [total, pending, approved, rejected] = await Promise.all([
      Customer.countDocuments(),
      Customer.countDocuments({ status: "PENDING" }),
      Customer.countDocuments({ status: "APPROVED" }),
      Customer.countDocuments({ status: "REJECTED" }),
    ]);
    return { success: true, data: { total, pending, approved, rejected } };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.post("/admin/customers/status", async (request, reply) => {
  try {
    const { customerId, status } = request.body;
    if (!customerId || !["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      return reply.status(400).send({
        success: false,
        message: "Valid customerId and status are required",
      });
    }
    const customer = await Customer.findOneAndUpdate(
      { customerId },
      { status },
      { new: true },
    ).select("-passwordHash");
    if (!customer) {
      return reply
        .status(404)
        .send({ success: false, message: "Customer not found" });
    }

    const statusMsg =
      status === "APPROVED"
        ? "Your customer portal account has been approved! You can now log in and book shipments."
        : status === "REJECTED"
          ? "Your customer portal registration was not approved. Please contact support for details."
          : "Your account status has been updated.";
    sendEmail(
      customer.email,
      `Manvi Customer Portal - Account ${status}`,
      `<p>Hi ${customer.name},</p><p>${statusMsg}</p>`,
    ).catch(() => {});

    return {
      success: true,
      message: `Customer ${customerId} status updated to ${status}`,
      data: customer,
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============================================================
// PORTAL — SHIPMENT BOOKING
// ============================================================

fastify.post("/portal/create-shipment", async (request, reply) => {
  try {
    const {
      accountCode,
      customerName,
      sector,
      destination,
      shipper,
      receiver,
      boxes,
      contentDescription,
      invoiceValue,
      currency,
      invoiceNo,
      invoiceDate,
      termsOfSale,
      reasonForExport,
      service,
      network,
      chargeableWt,
      basicAmt,
      cgstAmt,
      sgstAmt,
      igstAmt,
      totalAmt,
    } = request.body;

    const safeAccountCode = String(accountCode || "1270").trim();

    if (!receiver?.receiverName || !service) {
      return reply.status(400).send({
        success: false,
        message: "Missing required shipment fields",
      });
    }

    const customer = (await Customer.findOne({
      customerId: safeAccountCode,
    }).lean()) || {
      customerId: safeAccountCode,
      balance: 0,
      status: "APPROVED",
    };

    const accountBalance = Number(customer.balance || 0);
    const total = Number(totalAmt || 0);
    const isHold = total > accountBalance;

    const timestamp = Date.now().toString().slice(-8);
    const awbForManvi = `AWB${timestamp}${Math.floor(100 + Math.random() * 900)}`;

    const tempAwbNo = `M5C-TEMP-${timestamp}${Math.floor(100 + Math.random() * 900)}`;
    const genInvoiceNo =
      invoiceNo || `INV-${new Date().getFullYear()}-${timestamp}`;

    const receiverCountryCode = getCountryCode(
      receiver?.receiverCountry || destination || "INTERNATIONAL",
    );
    const destinationCode = getCountryCode(
      destination || receiver?.receiverCountry || "INTERNATIONAL",
    );

    const productDetails = (boxes || []).map((b, idx) => ({
      BoxNo: String(idx + 1),
      Description:
        b.productDescription || contentDescription || "General Merchandise",
      HSNCode: b.hsnCode || "",
      HTSCode: b.hsnCode || "",
      UnitType: "PCS",
      Qty: Number(b.qty) || 1,
      UnitRate: Number(b.unitRate) || 0,
      ShipPieceIGST: 0,
      PieceWt: Number(b.weightKg) || 0,
    }));

    const basic = Number(basicAmt) || 0;
    const cgst = Number(cgstAmt) || 0;
    const sgst = Number(sgstAmt) || 0;
    const igst = Number(igstAmt) || 0;

    const orderPayload = {
      Awbno: awbForManvi,
      AccountCode: safeAccountCode,
      AccountName: customerName || shipper?.shipperName || "Default Account",
      Origin: "DEL",
      PaymentType: "Credit",
      ShipDate: new Date().toISOString(),
      Sender: {
        SenderName: shipper?.shipperName,
        SenderContactPerson: shipper?.shipperName,
        SenderAddressLine1: shipper?.shipperAddress,
        SenderPincode: shipper?.shipperPincode,
        SenderCity: shipper?.shipperCity,
        SenderState: shipper?.shipperState,
        SenderTelephone: shipper?.shipperPhone,
        SenderEmailId: shipper?.shipperEmail,
        KYCType: "GSTIN",
        KYCNo: shipper?.shipperGstin || "N/A",
      },
      Receiver: {
        ReceiverName: receiver?.receiverName,
        ReceiverContactPerson: receiver?.receiverName,
        ReceiverAddressLine1: receiver?.receiverAddress,
        ReceiverZipcode: receiver?.receiverZipcode,
        ReceiverCity: receiver?.receiverCity,
        ReceiverState: receiver?.receiverState || receiver?.receiverCity,
        ReceiverCountry: receiverCountryCode,
        ReceiverTelephone: receiver?.receiverPhone,
        ReceiverEmailid: receiver?.receiverEmail,
      },
      ServiceDetails: {
        ServiceCode: service,
        ServiceName: service,
        Forwarder: network || "SELF",
        NetworkCode: network || "SELF",
        NetworkName: network || "Manvi Network",
        NetworkNo: "01",
        GoodsType: "NDOX",
        PackageType: "PACKAGE",
      },
      PackageDetails: {
        PackageDetail: (boxes || []).map((b) => ({
          Length: Number(b.lengthCm) || 10,
          Width: Number(b.widthCm) || 10,
          Height: Number(b.heightCm) || 10,
          ActualWeight: Number(b.weightKg) || 1,
        })),
      },
      AdditionalDetails: {
        IsThirdParty: false,
        ProductDetails: productDetails,
        InvoiceCurrency: currency || "USD",
        InvoiceNo: genInvoiceNo,
        InvoiceDate: invoiceDate
          ? new Date(invoiceDate).toISOString()
          : new Date().toISOString(),
        TermsOfSale: termsOfSale || "DAP",
        ReasonForExport: reasonForExport || "Sale",
        FreightCharge: basic,
        InsuranceCharge: 0,
        CSB_Type: "CSB 4",
        CustomerRefNo: tempAwbNo,
        DeliveryConfirmation: "SIGNATURE",
        DutyTax: "DDU",
        DutiesAccountNo: "",
        TransactionId: `TXN${timestamp}`,
        IECNo: "",
        ADCode: "",
        BankType: "P",
        NFEI: false,
        Ecom: false,
        MEIS: false,
        BankAccount: "",
        ProductType: "Commercial",
        BoundUT: "NA",
        IGSTAmount: igst,
        IGSTPaid: igst > 0 ? "Yes" : "No",
        ShipperImage: "",
        ShipperKYC: "",
        FileName: "",
      },
      FreightDetails: {
        BasicAmount: basic,
        FuelPercentage: 0,
        Fuel: 0,
        MisFuel: 0,
        Misc: 0,
        Demand: 0,
        GreenSuch: 0,
        Taxable: basic,
        SGST: sgst,
        CGST: cgst,
        IGST: igst,
        NTaxable: 0,
        NetTotal: total,
      },
    };

    let manviResult = { Status: true };
    let awbNoFromManvi = null;

    try {
      const manviRes = await fetch(
        "http://api.manvicourier.com/api/shipment/order_create",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderPayload),
        },
      );

      manviResult = await manviRes.json().catch(() => ({ Status: true }));

      if (manviResult) {
        awbNoFromManvi =
          manviResult?.Data?.AwbNo ||
          manviResult?.Data?.Awbno ||
          manviResult?.Data?.awbNo ||
          manviResult?.data?.AwbNo ||
          manviResult?.data?.Awbno ||
          manviResult?.data?.awbNo ||
          manviResult?.AwbNo ||
          manviResult?.Awbno ||
          manviResult?.awbNo ||
          null;
      }
    } catch (manviErr) {
      console.error(
        "MANVI order-create call failed (shipment still saved locally):",
        manviErr.message,
      );
    }

    const finalAwbNo = awbNoFromManvi || awbForManvi;

    const shipment = await Shipment.create({
      awbNo: finalAwbNo,
      accountCode: safeAccountCode,
      customerName: customerName || shipper?.shipperName || "Default Account",
      sector,
      destination: destinationCode,
      shipper,
      receiver: {
        ...receiver,
        receiverCountry: receiverCountryCode,
      },
      boxes,
      products: productDetails.map((p) => ({
        boxNo: p.BoxNo,
        description: p.Description,
        hsnCode: p.HSNCode,
        unitType: p.UnitType,
        qty: p.Qty,
        unitRate: p.UnitRate,
        pieceWt: p.PieceWt,
      })),
      contentDescription,
      invoiceValue,
      invoiceNo: genInvoiceNo,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      termsOfSale: termsOfSale || "DAP",
      reasonForExport: reasonForExport || "Sale",
      currency,
      service,
      network,
      chargeableWt,
      basicAmt: basic,
      cgstAmt: cgst,
      sgstAmt: sgst,
      igstAmt: igst,
      totalAmt: total,
      status: isHold ? "ON_HOLD" : "BOOKED",
      isHold,
      source: "Portal",
      manviResponse: manviResult,
      events: [
        {
          eventDescription: isHold
            ? "Order Received — On Hold"
            : "Order Confirmed",
          location: destinationCode,
        },
      ],
    });

    if (!isHold && customer?.customerId) {
      if (customer?.balance !== undefined) {
        await Customer.findOneAndUpdate(
          { customerId: safeAccountCode },
          {
            $set: {
              balance: Math.max(0, Number(customer.balance || 0) - total),
            },
          },
        );
      }
    }

    return reply.send({
      success: true,
      message: isHold
        ? "Shipment created but placed on hold — insufficient balance."
        : "Shipment created successfully!",
      booking: shipment,
      awbNo: finalAwbNo,
      isHold,
      awbSource: awbNoFromManvi ? "manvi_api" : "local_generated",
    });
  } catch (error) {
    console.error("Portal create-shipment error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/portal/shipments", async (request, reply) => {
  try {
    const { accountCode } = request.query;
    if (!accountCode)
      return reply
        .status(400)
        .send({ success: false, message: "accountCode is required" });
    const shipments = await Shipment.find({ accountCode })
      .sort({ createdAt: -1 })
      .lean();
    return { success: true, data: shipments };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============================================================
// ADMIN — SHIPMENT / TRACKING CRUD
// ============================================================

fastify.post("/admin/shipments", async (request, reply) => {
  try {
    const body = request.body;
    if (!body.awbNo) {
      const timestamp = Date.now().toString().slice(-8);
      body.awbNo = `M5C-${timestamp}${Math.floor(100 + Math.random() * 900)}`;
    }
    const existing = await Shipment.findOne({ awbNo: body.awbNo });
    if (existing) {
      return reply
        .status(409)
        .send({ success: false, message: `AWB ${body.awbNo} already exists` });
    }
    if (!body.events || body.events.length === 0) {
      body.events = [
        {
          eventDescription: "Order Confirmed",
          eventDate: new Date(),
          location: body.destination || "",
        },
      ];
    }
    const shipment = await Shipment.create(body);
    return reply.send({
      success: true,
      data: shipment,
      message: "Shipment created successfully",
    });
  } catch (error) {
    if (error.code === 11000) {
      return reply.status(409).send({
        success: false,
        message: "A shipment with this AWB already exists",
      });
    }
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/shipments", async (request, reply) => {
  try {
    const { status, accountCode, q, page = 1, limit = 50 } = request.query;
    const filter = {};
    if (status && status !== "ALL") filter.status = status;
    if (accountCode) filter.accountCode = accountCode;
    if (q) {
      const regex = new RegExp(q, "i");
      filter.$or = [
        { awbNo: regex },
        { customerName: regex },
        { destination: regex },
      ];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [shipments, total] = await Promise.all([
      Shipment.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Shipment.countDocuments(filter),
    ]);
    return { success: true, data: shipments, total, page: parseInt(page) };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.get("/admin/shipments/:awb", async (request, reply) => {
  try {
    const shipment = await Shipment.findOne({
      awbNo: request.params.awb,
    }).lean();
    if (!shipment)
      return reply
        .status(404)
        .send({ success: false, message: "Shipment not found" });
    return { success: true, data: shipment };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.put("/admin/shipments/:awb", async (request, reply) => {
  try {
    const { awbNo, events, ...rest } = request.body;
    const shipment = await Shipment.findOneAndUpdate(
      { awbNo: request.params.awb },
      { ...rest, updatedAt: new Date() },
      { new: true, runValidators: true },
    );
    if (!shipment)
      return reply
        .status(404)
        .send({ success: false, message: "Shipment not found" });
    return {
      success: true,
      data: shipment,
      message: "Shipment updated successfully",
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.delete("/admin/shipments/:awb", async (request, reply) => {
  try {
    const shipment = await Shipment.findOneAndDelete({
      awbNo: request.params.awb,
    });
    if (!shipment)
      return reply
        .status(404)
        .send({ success: false, message: "Shipment not found" });
    return { success: true, message: "Shipment deleted successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.post("/admin/shipments/:awb/events", async (request, reply) => {
  try {
    const { eventCode, eventDescription, eventDate, eventTime, location } =
      request.body;
    if (!eventDescription) {
      return reply
        .status(400)
        .send({ success: false, message: "eventDescription is required" });
    }
    const shipment = await Shipment.findOneAndUpdate(
      { awbNo: request.params.awb },
      {
        $push: {
          events: {
            eventCode,
            eventDescription,
            eventDate: eventDate || new Date(),
            eventTime,
            location,
          },
        },
      },
      { new: true },
    );
    if (!shipment)
      return reply
        .status(404)
        .send({ success: false, message: "Shipment not found" });
    return { success: true, data: shipment, message: "Event added" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.put("/admin/shipments/:awb/events/:eventId", async (request, reply) => {
  try {
    const shipment = await Shipment.findOne({ awbNo: request.params.awb });
    if (!shipment)
      return reply
        .status(404)
        .send({ success: false, message: "Shipment not found" });
    const event = shipment.events.id(request.params.eventId);
    if (!event)
      return reply
        .status(404)
        .send({ success: false, message: "Event not found" });
    Object.assign(event, request.body);
    await shipment.save();
    return { success: true, data: shipment, message: "Event updated" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

fastify.delete(
  "/admin/shipments/:awb/events/:eventId",
  async (request, reply) => {
    try {
      const shipment = await Shipment.findOneAndUpdate(
        { awbNo: request.params.awb },
        { $pull: { events: { _id: request.params.eventId } } },
        { new: true },
      );
      if (!shipment)
        return reply
          .status(404)
          .send({ success: false, message: "Shipment not found" });
      return { success: true, data: shipment, message: "Event deleted" };
    } catch (error) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  },
);

// ============================================================
// SEND SHIPMENT NOTIFICATION EMAIL - FIXED
// ============================================================

fastify.post("/api/send-shipment-email", async (request, reply) => {
  try {
    const { to, subject, html, shipmentData } = request.body;

    console.log("[Email] 📧 Received request to send shipment notification");
    console.log("[Email] 📋 To:", to);
    console.log("[Email] 📋 Subject:", subject);
    console.log("[Email] 📋 Has HTML:", !!html);

    // Validate required fields
    if (!to || !subject || !html) {
      console.error("[Email] ❌ Missing required fields");
      return reply.status(400).send({
        success: false,
        message: "Missing required fields: to, subject, html",
      });
    }

    // Validate email format
    if (!to.includes("@")) {
      console.error(`[Email] ❌ Invalid email format: ${to}`);
      return reply.status(400).send({
        success: false,
        message: "Invalid email format",
      });
    }

    // Send email to the recipient
    const result = await sendEmail(
      to,
      subject,
      html,
      process.env.SMTP_USER || "harmanjeet@m5clogs.com",
    );

    console.log("[Email] 📊 Send result:", result);

    if (!result.success) {
      console.error("[Email] ❌ Failed to send:", result.error);
      return reply.status(500).send({
        success: false,
        message: "Failed to send email",
        error: result.error,
      });
    }

    // Send CC to admin if configured and different
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL !== to) {
      try {
        console.log(`[Email] 📧 Sending CC to: ${process.env.ADMIN_EMAIL}`);
        await sendEmail(
          process.env.ADMIN_EMAIL,
          `[CC] ${subject}`,
          html,
          process.env.SMTP_USER || "harmanjeet@m5clogs.com",
        );
        console.log("[Email] ✅ CC email sent successfully");
      } catch (ccErr) {
        console.error("[Email] ⚠️ CC email failed:", ccErr.message);
        // Don't fail the main request if CC fails
      }
    }

    return reply.send({
      success: true,
      message: "Email sent successfully",
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("[Email] ❌ Send shipment email error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Failed to send email",
      error: error.message,
    });
  }
});

// ============================================================
// TEST EMAIL ENDPOINT
// ============================================================

fastify.post("/api/test-email", async (request, reply) => {
  try {
    const { to = "info@manvicourier.com", subject, html } = request.body || {};

    console.log("[Test Email] 📧 Testing email configuration...");

    const testHtml =
      html ||
      `
      <!DOCTYPE html>
      <html>
        <head><meta charset="UTF-8"></head>
        <body>
          <h2>📧 Email Configuration Test</h2>
          <p>If you're receiving this email, your SMTP configuration is working correctly!</p>
          <hr>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Server:</strong> ${process.env.SMTP_HOST || "N/A"}</p>
          <p><strong>User:</strong> ${process.env.SMTP_USER || "N/A"}</p>
          <p><strong>Port:</strong> ${process.env.SMTP_PORT || "587"}</p>
          <hr>
          <p><small>Manvi Courier Portal - Automated Test</small></p>
        </body>
      </html>
    `;

    const result = await sendEmail(
      to,
      subject || "Test Email from Manvi Courier Portal",
      testHtml,
    );

    return reply.send({
      success: result.success,
      message: result.success ? "Email sent successfully" : "Email failed",
      messageId: result.messageId,
      error: result.error,
      config: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        user: process.env.SMTP_USER,
        hasPassword: !!process.env.SMTP_PASS,
      },
    });
  } catch (error) {
    console.error("[Test Email] ❌ Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

fastify.get("/admin/shipments/stats/summary", async (request, reply) => {
  try {
    const [total, booked, hold, delivered] = await Promise.all([
      Shipment.countDocuments(),
      Shipment.countDocuments({ status: "BOOKED" }),
      Shipment.countDocuments({ status: "ON_HOLD" }),
      Shipment.countDocuments({ status: "DELIVERED" }),
    ]);
    return { success: true, data: { total, booked, hold, delivered } };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============= SERVER START =============

const connectDB = async () => {
  mongoose.connection.on("disconnected", () =>
    console.warn("MongoDB disconnected!"),
  );
  mongoose.connection.on("error", (err) =>
    console.error(`MongoDB error: ${err.message}`),
  );
  const conn = await mongoose.connect(process.env.MONGODB_URI);
  console.log(`MongoDB Connected: ${conn.connection.host}`);
};

fastify.post("/api/subscribe", async (req, reply) => {
  const { email, firstName = "" } = req.body || {};
  if (!email || !email.includes("@")) {
    return reply.status(400).send({ success: false, error: "Invalid email" });
  }
  try {
    const subscriber = await Subscriber.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      { email: email.toLowerCase().trim(), firstName, active: true },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (process.env.BREVO_API_KEY) {
      try {
        const brevoRes = await fetch("https://api.brevo.com/v3/contacts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": process.env.BREVO_API_KEY,
          },
          body: JSON.stringify({
            email: email.toLowerCase().trim(),
            attributes: firstName ? { FIRSTNAME: firstName } : {},
            listIds: [3],
            updateEnabled: true,
          }),
        });
        if (brevoRes.ok || brevoRes.status === 204) {
          await Subscriber.findByIdAndUpdate(subscriber._id, {
            brevoSynced: true,
          });
        }
      } catch (brevoErr) {
        console.warn("Brevo sync failed (non-fatal):", brevoErr.message);
      }
    }

    return reply.send({ success: true, message: "Subscribed successfully" });
  } catch (err) {
    console.error("Subscribe error:", err);
    return reply.status(500).send({ success: false, error: "Server error" });
  }
});

fastify.get("/api/subscribers", async (req, reply) => {
  try {
    const subscribers = await Subscriber.find({ active: true })
      .sort({ createdAt: -1 })
      .select("email firstName source brevoSynced createdAt");
    return reply.send({
      success: true,
      data: subscribers,
      count: subscribers.length,
    });
  } catch (err) {
    return reply.status(500).send({ success: false, error: "Server error" });
  }
});

fastify.post("/admin/newsletter/send", async (req, reply) => {
  const { subject, htmlContent, senderName, senderEmail } = req.body || {};

  if (!subject || !htmlContent || !senderEmail) {
    return reply.status(400).send({
      success: false,
      error: "subject, htmlContent, and senderEmail are required",
    });
  }
  if (!process.env.BREVO_API_KEY) {
    return reply
      .status(500)
      .send({ success: false, error: "BREVO_API_KEY not configured" });
  }

  try {
    const createRes = await fetch("https://api.brevo.com/v3/emailCampaigns", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        name: `${subject} — ${new Date().toISOString()}`,
        subject,
        htmlContent,
        sender: { name: senderName || "Manvi Logistics", email: senderEmail },
        recipients: { listIds: [3] },
        type: "classic",
      }),
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      return reply.status(500).send({
        success: false,
        error: createData.message || "Failed to create campaign in Brevo",
      });
    }

    const campaignId = createData.id;

    const sendRes = await fetch(
      `https://api.brevo.com/v3/emailCampaigns/${campaignId}/sendNow`,
      {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY },
      },
    );

    if (!sendRes.ok) {
      const sendData = await sendRes.json().catch(() => ({}));
      return reply.status(500).send({
        success: false,
        error: sendData.message || "Campaign created but failed to send",
      });
    }

    return reply.send({
      success: true,
      campaignId,
      message: "Campaign sent successfully",
    });
  } catch (err) {
    console.error("Newsletter send error:", err);
    return reply.status(500).send({ success: false, error: "Server error" });
  }
});

const start = async () => {
  try {
    await connectDB();
    await seedBlogs();
    const port = process.env.PORT || 5000;
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`Server listening on http://localhost:${port}`);

    // Automatic Self-Keep-Alive (prevents Render free tier 15-min cold start sleep)
    const SERVER_URL = process.env.RENDER_EXTERNAL_URL || "https://manvi-node-server.onrender.com";
    setInterval(async () => {
      try {
        await fetch(`${SERVER_URL}/health`);
        console.log(`[Keep-Alive Self-Ping] Pinged ${SERVER_URL}/health at ${new Date().toISOString()}`);
      } catch (err) {
        console.error("[Keep-Alive Self-Ping Error]:", err.message);
      }
    }, 10 * 60 * 1000); // Ping every 10 minutes
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

const closeGracefully = async (signal) => {
  console.log(`\n[${signal}] Shutting down…`);
  try {
    await fastify.close();
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error("Shutdown error:", err);
    process.exit(1);
  }
};

process.on("SIGINT", () => closeGracefully("SIGINT"));
process.on("SIGTERM", () => closeGracefully("SIGTERM"));
