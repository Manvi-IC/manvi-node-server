import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyIO from "fastify-socket.io";
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

import Message from "./models/Message.js";
import Task from "./models/Task.js";
import Admin from "./models/Admin.js";
import SiteSettings from "./models/SiteSettings.js";
import WalkinRate from "./models/WalkinRate.js";
import ZipZone from "./models/ZipZone.js";
import UploadLog from "./models/UploadLog.js";
import Blog from "./models/Blog.js";
import { INITIAL_BLOG_POSTS } from "./seedBlogs.js";
import QuoteEnquiry from "./models/QuoteEnquiry.js";

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

// Nodemailer Configuration with explicit SMTP settings
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
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
});

// Verify email configuration
transporter.verify((error, success) => {
  if (error) {
    console.error("SMTP Configuration Error:", error);
    console.log(
      "Please check your SMTP credentials and ensure you're using an App Password",
    );
  } else {
    console.log("SMTP Server is ready to send emails");
  }
});

const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
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

fastify.register(fastifyIO, {
  cors: { origin: frontendUrl, methods: ["GET", "POST"], credentials: true },
  transports: ["websocket"],
});

fastify.register(fastifyCompress, { threshold: 1024 });
fastify.register(fastifyMultipart, { limits: { fileSize: 20 * 1024 * 1024 } });

// ============= EMAIL HELPER FUNCTION =============
async function sendEmail(to, subject, html, from = process.env.SMTP_USER) {
  try {
    const mailOptions = {
      from: `"Manvi International" <${from}>`,
      to,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Email sending error:", error);
    return { success: false, error: error.message };
  }
}

// ============= ROUTES =============

fastify.get("/", async () => ({
  status: "M5 Node Server is Running",
  version: "1.0.0",
}));

fastify.get("/site-settings", async (request, reply) => {
  try {
    let settings = await SiteSettings.findOne();
    if (!settings) settings = await SiteSettings.create({});
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
    return { success: true, data: updated };
  } catch {
    return reply
      .status(500)
      .send({ success: false, message: "Failed to update settings" });
  }
});

fastify.post("/admin/login", async (request, reply) => {
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
    return reply.status(500).send({ success: false, message: "Login failed" });
  }
});

fastify.get("/chat/recent-users", async (request, reply) => {
  const { userId } = request.query;
  try {
    const recentConversations = await Message.aggregate([
      { $match: { $or: [{ senderId: userId }, { receiverId: userId }] } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: {
            $cond: [{ $eq: ["$senderId", userId] }, "$receiverId", "$senderId"],
          },
          lastMessage: { $first: "$text" },
          lastTimestamp: { $first: "$timestamp" },
        },
      },
      { $sort: { lastTimestamp: -1 } },
    ]);
    return { success: true, data: recentConversations };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

fastify.get("/chat/unread-counts", async (request, reply) => {
  const { userId } = request.query;
  try {
    const unreadCounts = await Message.aggregate([
      { $match: { receiverId: userId, read: false, type: "private" } },
      { $group: { _id: "$senderId", count: { $sum: 1 } } },
    ]);
    const counts = {};
    unreadCounts.forEach((item) => {
      if (item._id) counts[item._id] = item.count;
    });
    return { success: true, data: counts };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

fastify.post("/chat/mark-read", async (request, reply) => {
  const { userId, senderId } = request.body;
  try {
    await Message.updateMany(
      { receiverId: userId, senderId, read: false },
      { $set: { read: true } },
    );
    return { success: true };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

fastify.get("/chat/history", async (request, reply) => {
  const { user1, user2, type } = request.query;
  try {
    if (type === "broadcast") {
      const messages = await Message.find({ type: "broadcast" })
        .sort({ timestamp: 1 })
        .limit(100)
        .lean();
      return { success: true, data: messages };
    }
    const messages = await Message.find({
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 },
      ],
    })
      .sort({ timestamp: 1 })
      .limit(100)
      .lean();
    return { success: true, data: messages };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

fastify.get("/tasks/unread-count", async (request, reply) => {
  const { userId } = request.query;
  try {
    const count = await Task.countDocuments({
      "assignedTo.userId": userId,
      isRead: false,
      status: { $ne: "completed" },
    });
    return { success: true, count };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

fastify.post("/tasks/trigger-update", async (request, reply) => {
  const { userId } = request.body;
  try {
    const count = await Task.countDocuments({
      "assignedTo.userId": userId,
      isRead: false,
      status: { $ne: "completed" },
    });
    fastify.io.to(userId).emit("task_unread_count", { count });
    return { success: true, count };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

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
  const headerRow = raw[0];
  const zoneHeaders = headerRow
    .slice(6)
    .filter((v) => v !== null && v !== undefined);
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row[0] || row[0] === "SHIPPER") continue;
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
    zoneHeaders.forEach((zoneNum, idx) => {
      const val = row[6 + idx];
      if (val !== null && val !== undefined && !isNaN(parseFloat(val))) {
        const zoneKey = String(Math.round(parseFloat(zoneNum)));
        zones[zoneKey] = Math.round(parseFloat(val) * 100) / 100;
      }
    });
    if (Object.keys(zones).length === 0) continue;
    rows.push({ shipper, network, service, type, minWt, maxWt, zones });
  }
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
    s.includes("DPD")
  )
    return "5–8 business days";
  if (s.includes("DHL") || s.includes("FEDEX") || s.includes("UPS"))
    return "4–7 business days";
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
      errorMessage;

    try {
      if (isZoningFile) {
        const rows = parseZoningFile(workbook);
        const services = [...new Set(rows.map((r) => r.service))];
        await ZipZone.deleteMany({
          service: { $in: services },
          zipcode: { $not: /^\d/ },
        });
        const docs = rows.map((r) => ({ ...r, uploadId }));
        const res = await rawBulkInsert(ZipZone, docs);
        rowsInserted = res.inserted;
        rowsFailed = res.failed;
      } else if (fileType === "zipcodes") {
        const rows = parseZipCodes(workbook);
        const services = [...new Set(rows.map((r) => r.service))];
        await ZipZone.deleteMany({
          service: { $in: services },
          zipcode: { $regex: /^\d/ },
        });
        const docs = rows.map((r) => ({ ...r, uploadId }));
        const res = await rawBulkInsert(ZipZone, docs);
        rowsInserted = res.inserted;
        rowsFailed = res.failed;
      } else {
        const rows = parseWalkinRates(workbook);
        const services = [...new Set(rows.map((r) => r.service))];
        await WalkinRate.deleteMany({ service: { $in: services } });
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

    return {
      success: status !== "failed",
      uploadId,
      fileType,
      rowsInserted,
      rowsFailed,
      message:
        status === "failed"
          ? `Upload failed: ${errorMessage || "No rows inserted"}`
          : `Uploaded successfully: ${rowsInserted} records inserted`,
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

// ---------------------------------------------------------------------------
// GET /rates/quote
// ---------------------------------------------------------------------------
fastify.get("/rates/quote", async (request, reply) => {
  const activeDbName = mongoose.connection.name;
  console.log(
    `[Quote Request] Using Mongoose connection database: "${activeDbName}"`,
  );

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

    console.log(
      `[Quote Request] Query params - country: "${country}", actualWt: ${actualWt}, zipcode: "${zipcode}", zoningCountry: "${zoningCountry}"`,
    );

    if (!actualWt || !country) {
      console.warn("[Quote Request] Missing required actualWt or country");
      return reply
        .status(400)
        .send({ success: false, message: "actualWt and country are required" });
    }

    const volWt =
      length && breadth && height ? (length * breadth * height) / 5000 : 0;
    const chargeableWt = Math.ceil(Math.max(actualWt, volWt));
    console.log(
      `[Quote Request] Calculated volWt: ${volWt}, chargeableWt: ${chargeableWt}`,
    );

    const ZIPCODE_COUNTRIES = ["AUSTRALIA", "CANADA"];
    if (ZIPCODE_COUNTRIES.includes(country) && !zipcode) {
      console.warn(
        `[Quote Request] Missing zipcode for zipcode-required country: ${country}`,
      );
      return reply.status(400).send({
        success: false,
        message: `Zipcode is required for ${country}`,
      });
    }

    const serviceList = SERVICE_DESTINATION_MAP[country];
    if (!serviceList) {
      console.warn(`[Quote Request] Unknown destination country: "${country}"`);
      return reply
        .status(400)
        .send({ success: false, message: `Unknown destination: ${country}` });
    }

    console.log(
      `[Quote Request] Found ${serviceList.length} services mapped for destination ${country}`,
    );
    const results = [];

    for (const svc of serviceList) {
      try {
        let zone = null;

        if (svc.zone) {
          zone = svc.zone;
          console.log(
            `[Quote Request] Service "${svc.service}" hardcoded zone: ${zone}`,
          );
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
            if (zoneDoc) {
              console.log(
                `[Quote Request] Service "${svc.service}" zip lookup match for "${tryZip}": Zone ${zoneDoc.zone}`,
              );
              break;
            }
          }
          if (!zoneDoc) {
            console.log(
              `[Quote Request] Service "${svc.service}" zip lookup failed for "${cleanZip}"`,
            );
            continue;
          }
          zone = String(zoneDoc.zone);
        } else if (svc.zoningCountry) {
          const zoneDoc = await ZipZone.findOne({
            service: svc.service,
            zipcode: svc.zoningCountry,
          }).lean();
          if (!zoneDoc) {
            console.log(
              `[Quote Request] Service "${svc.service}" zoningCountry lookup failed for "${svc.zoningCountry}"`,
            );
            continue;
          }
          zone = String(zoneDoc.zone);
          console.log(
            `[Quote Request] Service "${svc.service}" zoningCountry "${svc.zoningCountry}" resolved to Zone ${zone}`,
          );
        } else if (svc.zoningFromInput) {
          const lookup = zoningCountry || country;
          const zoneDoc = await ZipZone.findOne({
            service: svc.service,
            zipcode: lookup,
          }).lean();
          if (!zoneDoc) {
            console.log(
              `[Quote Request] Service "${svc.service}" zoningFromInput lookup failed for "${lookup}"`,
            );
            continue;
          }
          zone = String(zoneDoc.zone);
          console.log(
            `[Quote Request] Service "${svc.service}" zoningFromInput "${lookup}" resolved to Zone ${zone}`,
          );
        }

        if (!zone) {
          console.log(
            `[Quote Request] Service "${svc.service}" zone could not be resolved`,
          );
          continue;
        }

        const [rateDocS, rateDocB] = await Promise.all([
          WalkinRate.findOne({
            service: svc.service,
            type: "S",
            minWt: { $lte: chargeableWt },
            maxWt: { $gte: chargeableWt },
          }).lean(),
          WalkinRate.findOne({
            service: svc.service,
            type: "B",
            minWt: { $lte: chargeableWt },
            maxWt: { $gte: chargeableWt },
          }).lean(),
        ]);

        console.log(
          `[Quote Request] Service "${svc.service}" rates query results - Slab doc: ${!!rateDocS}, Per-Kg doc: ${!!rateDocB}`,
        );

        for (const rd of [rateDocS, rateDocB].filter(Boolean)) {
          const zoneMap =
            rd.zones instanceof Map ? Object.fromEntries(rd.zones) : rd.zones;
          const rawPrice = zoneMap?.[zone];
          if (rawPrice === undefined || rawPrice === null || isNaN(rawPrice)) {
            console.log(
              `[Quote Request] Service "${svc.service}" price not found in rate doc for Zone "${zone}"`,
            );
            continue;
          }

          const totalPrice =
            rd.type === "S"
              ? Math.round(rawPrice)
              : Math.round(rawPrice * chargeableWt);

          console.log(
            `[Quote Request] Service "${svc.service}" (${rd.type}) resolved Price: ₹${totalPrice} (raw: ${rawPrice})`,
          );

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
    console.log(
      `[Quote Request] Successfully returning ${results.length} quotes`,
    );

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

fastify.get("/rates/countries", async (request, reply) => {
  try {
    const europeDpdCountries = await ZipZone.find(
      { service: "EX DEL EUROPE DPD" },
      { zipcode: 1, zone: 1, _id: 0 },
    ).lean();
    const intlCountries = await ZipZone.find(
      { service: "EX DEL BRANDED DHL NDOX" },
      { zipcode: 1, zone: 1, _id: 0 },
    ).lean();
    return {
      success: true,
      europe: europeDpdCountries.map((d) => d.zipcode).sort(),
      international: intlCountries.map((d) => d.zipcode).sort(),
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============= BLOG CRUD OPERATIONS =============

// Seed initial blogs
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

// Get all blogs (public)
fastify.get("/api/blogs", async (request, reply) => {
  try {
    const { category } = request.query;
    const filter = category && category !== "all" ? { category } : {};
    const blogs = await Blog.find(filter).sort({ createdAt: -1 });
    return { success: true, data: blogs };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// Get single blog by slug (public)
fastify.get("/api/blogs/:slug", async (request, reply) => {
  try {
    const blog = await Blog.findOne({ slug: request.params.slug });
    if (!blog) {
      return reply
        .status(404)
        .send({ success: false, message: "Blog not found" });
    }
    return { success: true, data: blog };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// Get all blogs (admin)
fastify.get("/admin/blogs", async (request, reply) => {
  try {
    const blogs = await Blog.find({}).sort({ createdAt: -1 });
    return { success: true, data: blogs };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// Get single blog by ID (admin)
fastify.get("/admin/blogs/:id", async (request, reply) => {
  try {
    const blog = await Blog.findById(request.params.id);
    if (!blog) {
      return reply
        .status(404)
        .send({ success: false, message: "Blog not found" });
    }
    return { success: true, data: blog };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// Create blog (admin)
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
    return { success: true, data: blog, message: "Blog created successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// Update blog (admin)
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
    if (!blog) {
      return reply
        .status(404)
        .send({ success: false, message: "Blog not found" });
    }
    return { success: true, data: blog, message: "Blog updated successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// Delete blog (admin)
fastify.delete("/admin/blogs/:id", async (request, reply) => {
  try {
    const blog = await Blog.findByIdAndDelete(request.params.id);
    if (!blog) {
      return reply
        .status(404)
        .send({ success: false, message: "Blog not found" });
    }
    return { success: true, message: "Blog deleted successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============= JOB CRUD OPERATIONS =============

// Get all jobs (with optional filter for active only)
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

// Get single job
fastify.get("/admin/jobs/:id", async (request, reply) => {
  try {
    const job = await Job.findById(request.params.id);
    if (!job) {
      return reply
        .status(404)
        .send({ success: false, message: "Job not found" });
    }
    return { success: true, data: job };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// Create job
fastify.post("/admin/jobs", async (request, reply) => {
  try {
    const job = new Job(request.body);
    await job.save();
    return { success: true, data: job, message: "Job created successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// Update job
fastify.put("/admin/jobs/:id", async (request, reply) => {
  try {
    const job = await Job.findByIdAndUpdate(
      request.params.id,
      { ...request.body, updatedAt: new Date() },
      { new: true, runValidators: true },
    );
    if (!job) {
      return reply
        .status(404)
        .send({ success: false, message: "Job not found" });
    }
    return { success: true, data: job, message: "Job updated successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// Delete job
fastify.delete("/admin/jobs/:id", async (request, reply) => {
  try {
    const job = await Job.findByIdAndDelete(request.params.id);
    if (!job) {
      return reply
        .status(404)
        .send({ success: false, message: "Job not found" });
    }
    return { success: true, message: "Job deleted successfully" };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============= JOB APPLICATION ROUTES =============

// Get all applications (for admin panel)
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

// Get single application
fastify.get("/admin/applications/:id", async (request, reply) => {
  try {
    const application = await JobApplication.findById(
      request.params.id,
    ).populate("jobId", "title department location");
    if (!application) {
      return reply
        .status(404)
        .send({ success: false, message: "Application not found" });
    }
    return { success: true, data: application };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// Update application status
fastify.put("/admin/applications/:id", async (request, reply) => {
  try {
    const { status, notes } = request.body;
    const application = await JobApplication.findByIdAndUpdate(
      request.params.id,
      { status, notes, updatedAt: new Date() },
      { new: true },
    );
    if (!application) {
      return reply
        .status(404)
        .send({ success: false, message: "Application not found" });
    }
    return {
      success: true,
      data: application,
      message: "Application updated successfully",
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// ============= RESUME DOWNLOAD ENDPOINT (FIXED) =============
fastify.get("/admin/download-resume/:applicationId", async (request, reply) => {
  try {
    const application = await JobApplication.findById(
      request.params.applicationId,
    );
    if (!application) {
      return reply.status(404).send({
        success: false,
        message: "Application not found",
      });
    }

    console.log(`📥 Downloading resume for: ${application.fullName}`);
    console.log(`📎 Resume URL: ${application.resumeUrl}`);
    console.log(`📎 Public ID: ${application.resumePublicId}`);

    let fileBuffer = null;
    const fileName = `${application.fullName.replace(/\s+/g, "_")}_Resume.pdf`;

    try {
      // Method 1: Try direct fetch with fl_attachment and raw flag
      console.log("🔄 Method 1: Direct fetch with fl_attachment...");
      const directUrl = `${application.resumeUrl}?fl_attachment=1&raw=1`;

      const response = await fetch(directUrl, {
        method: "GET",
        headers: {
          Accept: "application/pdf, application/octet-stream, */*",
          "User-Agent": "Mozilla/5.0",
        },
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
        console.log(
          `✅ Direct fetch successful, size: ${fileBuffer.length} bytes`,
        );
      } else {
        console.log(`⚠️ Direct fetch failed with status: ${response.status}`);

        // Method 2: Try using Cloudinary API with signed URL
        console.log("🔄 Method 2: Trying Cloudinary API with signed URL...");

        const timestamp = Math.floor(Date.now() / 1000) + 300;
        const publicId = application.resumePublicId;

        // Generate signature
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
          const arrayBuffer = await signedResponse.arrayBuffer();
          fileBuffer = Buffer.from(arrayBuffer);
          console.log(
            `✅ Signed URL fetch successful, size: ${fileBuffer.length} bytes`,
          );
        } else {
          console.log(
            `⚠️ Signed URL fetch failed with status: ${signedResponse.status}`,
          );

          // Method 3: Try Cloudinary API resource endpoint
          console.log(
            "🔄 Method 3: Trying Cloudinary API resource endpoint...",
          );

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
            console.log(`📎 Resource found: ${resourceData.secure_url}`);

            // Download using the secure_url from API
            const downloadResponse = await fetch(resourceData.secure_url, {
              method: "GET",
              headers: {
                Accept: "application/pdf, application/octet-stream, */*",
                "User-Agent": "Mozilla/5.0",
              },
            });

            if (downloadResponse.ok) {
              const arrayBuffer = await downloadResponse.arrayBuffer();
              fileBuffer = Buffer.from(arrayBuffer);
              console.log(
                `✅ API download successful, size: ${fileBuffer.length} bytes`,
              );
            } else {
              throw new Error(
                `API download failed: ${downloadResponse.status}`,
              );
            }
          } else {
            // Method 4: Last resort - try the original URL
            console.log("🔄 Method 4: Last resort - trying original URL...");
            const lastResponse = await fetch(application.resumeUrl, {
              method: "GET",
              headers: {
                Accept: "application/pdf, application/octet-stream, */*",
                "User-Agent": "Mozilla/5.0",
              },
            });

            if (lastResponse.ok) {
              const arrayBuffer = await lastResponse.arrayBuffer();
              fileBuffer = Buffer.from(arrayBuffer);
              console.log(
                `✅ Last resort successful, size: ${fileBuffer.length} bytes`,
              );
            } else {
              throw new Error(
                `All methods failed. Last status: ${lastResponse.status}`,
              );
            }
          }
        }
      }
    } catch (fetchError) {
      console.error("❌ Error in fetch methods:", fetchError.message);
      throw new Error(`Could not download file: ${fetchError.message}`);
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error("Downloaded file is empty");
    }

    console.log(`✅ Final file size: ${fileBuffer.length} bytes`);
    console.log(`✅ First 4 bytes: ${fileBuffer.slice(0, 4).toString()}`);

    // Set proper headers for download
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

// ============= SUBMIT JOB APPLICATION =============

// Submit job application (from frontend)
fastify.post("/api/jobs/apply", async (request, reply) => {
  try {
    const data = await request.file();
    if (!data) {
      return reply
        .status(400)
        .send({ success: false, message: "No file uploaded" });
    }

    // Extract form fields
    const fields = {};
    for (const [key, value] of Object.entries(data.fields)) {
      fields[key] = value.value;
    }

    const { jobId, fullName, email, phone, experience, noticePeriod } = fields;

    // Validate required fields
    if (!jobId || !fullName || !email || !experience || !noticePeriod) {
      return reply.status(400).send({
        success: false,
        message: "Missing required fields",
      });
    }

    // Get job details
    const job = await Job.findById(jobId);
    if (!job) {
      return reply
        .status(404)
        .send({ success: false, message: "Job not found" });
    }

    // Upload resume to Cloudinary
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
      console.error("Cloudinary upload error:", cloudinaryError);
      return reply.status(500).send({
        success: false,
        message: "Failed to upload resume. Please try again.",
      });
    }

    // Create application record
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

    // Send email notifications
    let emailErrors = [];

    // Admin notification
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
        <hr />
        <p>View all applications in the admin panel.</p>
      `;

      const adminEmailResult = await sendEmail(
        "harmanjeet.singh@iic.ac.in",
        `New Job Application: ${job.title} - ${fullName}`,
        adminEmailHtml,
      );

      if (!adminEmailResult.success) {
        emailErrors.push("Admin notification failed");
        console.error("Admin email failed:", adminEmailResult.error);
      }
    } catch (emailError) {
      emailErrors.push("Admin notification failed");
      console.error("Admin email error:", emailError);
    }

    // Applicant confirmation
    try {
      const confirmationHtml = `
        <h2>Thank you for applying at Manvi International</h2>
        <p>Dear ${fullName},</p>
        <p>We have received your application for the position of <strong>${job.title}</strong>.</p>
        <p>Our team will review your application and get back to you shortly.</p>
        <br />
        <p><strong>Application Summary:</strong></p>
        <ul>
          <li><strong>Position:</strong> ${job.title}</li>
          <li><strong>Department:</strong> ${job.department}</li>
          <li><strong>Location:</strong> ${job.location}</li>
          <li><strong>Experience:</strong> ${experience}</li>
          <li><strong>Notice Period:</strong> ${noticePeriod}</li>
        </ul>
        <br />
        <p>Best regards,</p>
        <p><strong>Manvi International Team</strong></p>
        <p><small>This is an automated confirmation. Please do not reply to this email.</small></p>
      `;

      const applicantEmailResult = await sendEmail(
        email,
        `Application Received: ${job.title} - Manvi International`,
        confirmationHtml,
      );

      if (!applicantEmailResult.success) {
        emailErrors.push("Applicant confirmation failed");
        console.error("Applicant email failed:", applicantEmailResult.error);
      }
    } catch (emailError) {
      emailErrors.push("Applicant confirmation failed");
      console.error("Applicant email error:", emailError);
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

// Submit speculative job application
fastify.post("/api/jobs/apply-speculative", async (request, reply) => {
  try {
    const data = await request.file();
    if (!data) {
      return reply
        .status(400)
        .send({ success: false, message: "No file uploaded" });
    }

    // Extract form fields
    const fields = {};
    for (const [key, value] of Object.entries(data.fields)) {
      fields[key] = value.value;
    }

    const { fullName, email, phone, experience, noticePeriod, message } =
      fields;

    // Validate required fields
    if (!fullName || !email || !experience || !noticePeriod) {
      return reply.status(400).send({
        success: false,
        message: "Missing required fields",
      });
    }

    // Upload resume to Cloudinary
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
      console.error("Cloudinary upload error:", cloudinaryError);
      return reply.status(500).send({
        success: false,
        message: "Failed to upload resume. Please try again.",
      });
    }

    // Create application record (with null jobId for speculative)
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

    // Send email notifications
    let emailErrors = [];

    try {
      const adminEmailHtml = `
        <h2>New Speculative Application Received</h2>
        <p><strong>Applicant:</strong> ${fullName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || "N/A"}</p>
        <p><strong>Experience:</strong> ${experience}</p>
        <p><strong>Notice Period:</strong> ${noticePeriod}</p>
        ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
        <p><strong>Resume:</strong> <a href="${cloudinaryResult.secure_url}">View Resume</a></p>
        <p><strong>Applied at:</strong> ${new Date().toLocaleString()}</p>
        <hr />
        <p>This is a speculative application. No specific role was applied for.</p>
        <p>View all applications in the admin panel.</p>
      `;

      await sendEmail(
        "harmanjeet.singh@iic.ac.in",
        `New Speculative Application - ${fullName}`,
        adminEmailHtml,
      );
    } catch (emailError) {
      emailErrors.push("Admin notification failed");
      console.error("Admin email error:", emailError);
    }

    try {
      const confirmationHtml = `
        <h2>Thank you for your interest in Manvi International</h2>
        <p>Dear ${fullName},</p>
        <p>We have received your speculative application.</p>
        <p>Our team will review your profile and get back to you if we find a suitable position.</p>
        <br />
        <p>Best regards,</p>
        <p><strong>Manvi International Team</strong></p>
      `;

      await sendEmail(
        email,
        `Application Received - Manvi International`,
        confirmationHtml,
      );
    } catch (emailError) {
      emailErrors.push("Applicant confirmation failed");
      console.error("Applicant email error:", emailError);
    }

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

// Get job applications count (for dashboard)
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

// ============= IMAGE UPLOAD ENDPOINT =============
fastify.post("/admin/upload-image", async (request, reply) => {
  try {
    const data = await request.file();
    if (!data) {
      return reply
        .status(400)
        .send({ success: false, message: "No file uploaded" });
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
      console.error("Cloudinary upload error:", cloudinaryError);
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
    console.error("Image upload endpoint error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
});
// ============================================================
// ADD THIS IMPORT at the top of server.js with other imports:
// import QuoteEnquiry from "./models/QuoteEnquiry.js";
// ============================================================

// ============================================================
// QUOTE ENQUIRY ROUTES  — paste these anywhere after your
// existing /rates/quote route
// ============================================================

// POST /quote-enquiries  — submitted from the Get Quote page
fastify.post("/quote-enquiries", async (request, reply) => {
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

    return {
      success: true,
      message: "Enquiry submitted successfully",
      id: enquiry._id,
    };
  } catch (error) {
    console.error("Quote enquiry submission error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// GET /admin/quote-enquiries  — list all, newest first
fastify.get("/admin/quote-enquiries", async (request, reply) => {
  try {
    const { status, page = 1, limit = 50 } = request.query;
    const filter = status && status !== "all" ? { status } : {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [enquiries, total] = await Promise.all([
      QuoteEnquiry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      QuoteEnquiry.countDocuments(filter),
    ]);

    return { success: true, data: enquiries, total, page: parseInt(page) };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// GET /admin/quote-enquiries/stats  — counts by status
fastify.get("/admin/quote-enquiries/stats", async (request, reply) => {
  try {
    const [total, newCount, contacted, converted, closed] = await Promise.all([
      QuoteEnquiry.countDocuments(),
      QuoteEnquiry.countDocuments({ status: "new" }),
      QuoteEnquiry.countDocuments({ status: "contacted" }),
      QuoteEnquiry.countDocuments({ status: "converted" }),
      QuoteEnquiry.countDocuments({ status: "closed" }),
    ]);
    return {
      success: true,
      data: { total, new: newCount, contacted, converted, closed },
    };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// GET /admin/quote-enquiries/:id  — single enquiry
fastify.get("/admin/quote-enquiries/:id", async (request, reply) => {
  try {
    const enquiry = await QuoteEnquiry.findById(request.params.id).lean();
    if (!enquiry)
      return reply.status(404).send({ success: false, message: "Not found" });
    return { success: true, data: enquiry };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// PUT /admin/quote-enquiries/:id  — update status / notes
fastify.put("/admin/quote-enquiries/:id", async (request, reply) => {
  try {
    const { status, notes } = request.body;
    const enquiry = await QuoteEnquiry.findByIdAndUpdate(
      request.params.id,
      {
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
        updatedAt: new Date(),
      },
      { new: true },
    ).lean();
    if (!enquiry)
      return reply.status(404).send({ success: false, message: "Not found" });
    return { success: true, data: enquiry };
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
});

// DELETE /admin/quote-enquiries/:id
fastify.delete("/admin/quote-enquiries/:id", async (request, reply) => {
  try {
    const enquiry = await QuoteEnquiry.findByIdAndDelete(request.params.id);
    if (!enquiry)
      return reply.status(404).send({ success: false, message: "Not found" });
    return { success: true, message: "Deleted successfully" };
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

const start = async () => {
  try {
    await connectDB();
    await seedBlogs();
    const port = process.env.PORT || 5000;
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`Server listening on http://localhost:${port}`);

    const userSockets = new Map();
    const userStatuses = new Map();

    fastify.ready((err) => {
      if (err) throw err;
      fastify.io.on("connection", (socket) => {
        console.log("Socket connected:", socket.id);

        socket.on("join_chat", async (userId) => {
          if (socket.userId && socket.userId !== userId) {
            const old = socket.userId;
            if (userSockets.has(old)) {
              userSockets.get(old).delete(socket.id);
              if (userSockets.get(old).size === 0) {
                userSockets.delete(old);
                userStatuses.delete(old);
                fastify.io.emit("status_update", {
                  userId: old,
                  status: "offline",
                });
              }
            }
          }
          socket.join(userId);
          socket.userId = userId;
          if (!userSockets.has(userId)) userSockets.set(userId, new Set());
          userSockets.get(userId).add(socket.id);
          userStatuses.set(userId, "online");
          fastify.io.emit("status_update", { userId, status: "online" });
          socket.emit("all_statuses", Object.fromEntries(userStatuses));
          try {
            const count = await Task.countDocuments({
              "assignedTo.userId": userId,
              isRead: false,
              status: { $ne: "completed" },
            });
            socket.emit("task_unread_count", { count });
          } catch (err) {
            console.error("Initial task count error:", err);
          }
        });

        socket.on("set_status", ({ userId, status }) => {
          if (userId && userSockets.has(userId)) {
            userStatuses.set(userId, status);
            fastify.io.emit("status_update", { userId, status });
          }
        });

        socket.on("send_message", async (data) => {
          try {
            const newMessage = new Message({
              senderId: data.senderId,
              senderName: data.senderName,
              receiverId: data.receiverId,
              receiverName: data.receiverName,
              text: data.text,
              type: data.type || "private",
              title: data.title,
              priority: data.priority || "normal",
            });
            await newMessage.save();
            if (data.type === "broadcast") {
              fastify.io.emit("receive_message", newMessage);
            } else {
              fastify.io
                .to(data.receiverId)
                .to(data.senderId)
                .emit("receive_message", newMessage);
            }
          } catch (error) {
            console.error("Socket send_message error:", error);
            socket.emit("send_message_error", {
              senderId: data.senderId,
              receiverId: data.receiverId,
              text: data.text,
              error: "Failed to send/save message",
            });
          }
        });

        socket.on("disconnect", () => {
          const userId = socket.userId;
          if (userId && userSockets.has(userId)) {
            userSockets.get(userId).delete(socket.id);
            if (userSockets.get(userId).size === 0) {
              userSockets.delete(userId);
              userStatuses.delete(userId);
              fastify.io.emit("status_update", { userId, status: "offline" });
            }
          }
        });
      });
    });
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
