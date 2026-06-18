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

import Message from "./models/Message.js";
import Task from "./models/Task.js";
import Admin from "./models/Admin.js";
import SiteSettings from "./models/SiteSettings.js";
import WalkinRate from "./models/WalkinRate.js";
import ZipZone from "./models/ZipZone.js";
import UploadLog from "./models/UploadLog.js";

const getTenantModels = (dbName) => {
  if (!dbName || dbName === "manvi") {
    return { Message, Task, Admin, SiteSettings, UploadLog, ZipZone, WalkinRate };
  }
  const tenantDb = mongoose.connection.useDb(dbName, { useCache: true });
  return {
    Message: tenantDb.models.Message || tenantDb.model("Message", Message.schema),
    Task: tenantDb.models.Task || tenantDb.model("Task", Task.schema),
    Admin: tenantDb.models.Admin || tenantDb.model("Admin", Admin.schema),
    SiteSettings: tenantDb.models.SiteSettings || tenantDb.model("SiteSettings", SiteSettings.schema),
    UploadLog: tenantDb.models.UploadLog || tenantDb.model("UploadLog", UploadLog.schema),
    ZipZone: tenantDb.models.ZipZone || tenantDb.model("ZipZone", ZipZone.schema),
    WalkinRate: tenantDb.models.WalkinRate || tenantDb.model("WalkinRate", WalkinRate.schema),
  };
};

dotenv.config();

if (!process.env.MONGODB_URI) {
  console.error("FATAL ERROR: MONGODB_URI is not defined.");
  process.exit(1);
}

const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
const frontendUrl = process.env.FRONTEND_URL || "*";

fastify.register(fastifyCors, {
  origin: frontendUrl === "*" ? true : [frontendUrl],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
});
fastify.register(fastifyIO, {
  cors: { origin: frontendUrl, methods: ["GET", "POST"], credentials: true },
  transports: ["websocket"],
});
fastify.register(fastifyCompress, { threshold: 1024 });
fastify.register(fastifyMultipart, { limits: { fileSize: 20 * 1024 * 1024 } });

fastify.get("/", async () => ({
  status: "M5 Node Server is Running",
  version: "1.0.0",
}));

fastify.get("/site-settings", async (request, reply) => {
  const dbName = request.headers["x-database"];
  if (!dbName)
    return reply
      .status(400)
      .send({ success: false, message: "x-database header is required" });
  try {
    const { SiteSettings } = getTenantModels(dbName);
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
  const dbName = request.headers["x-database"];
  if (!dbName)
    return reply
      .status(400)
      .send({ success: false, message: "x-database header is required" });
  try {
    const { SiteSettings } = getTenantModels(dbName);
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
  const dbName = request.headers["x-database"];
  if (!dbName)
    return reply
      .status(400)
      .send({ success: false, message: "x-database header is required" });
  try {
    const { username, password } = request.body;
    const { Admin } = getTenantModels(dbName);
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
  const { Message } = getTenantModels(request.headers["x-database"]);
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
  const { Message } = getTenantModels(request.headers["x-database"]);
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
  const { Message } = getTenantModels(request.headers["x-database"]);
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
  const { Message } = getTenantModels(request.headers["x-database"]);
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
  const { Task } = getTenantModels(request.headers["x-database"]);
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
  const { Task } = getTenantModels(request.headers["x-database"]);
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
  const dbName = request.headers['x-database'];
  const { UploadLog, ZipZone, WalkinRate } = getTenantModels(dbName);

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
      (!headerRow.includes("SHIPPER") && headerRow.includes("NETWORK") && !headerRow.includes("ZIPCODE")) ||
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
        try {
          const result = await ZipZone.insertMany(docs, { ordered: false });
          rowsInserted = result.length;
        } catch (bulkErr) {
          rowsInserted = bulkErr.result?.insertedCount || 0;
          rowsFailed = rows.length - rowsInserted;
        }
      } else if (fileType === "zipcodes") {
        const rows = parseZipCodes(workbook);
        const services = [...new Set(rows.map((r) => r.service))];
        await ZipZone.deleteMany({
          service: { $in: services },
          zipcode: { $regex: /^\d/ },
        });
        const docs = rows.map((r) => ({ ...r, uploadId }));
        try {
          const result = await ZipZone.insertMany(docs, { ordered: false });
          rowsInserted = result.length;
        } catch (bulkErr) {
          rowsInserted = bulkErr.result?.insertedCount || 0;
          rowsFailed = rows.length - rowsInserted;
        }
      } else {
        const rows = parseWalkinRates(workbook);
        const services = [...new Set(rows.map((r) => r.service))];
        await WalkinRate.deleteMany({ service: { $in: services } });
        const docs = rows.map((r) => ({ ...r, uploadId }));
        try {
          const result = await WalkinRate.insertMany(docs, { ordered: false });
          rowsInserted = result.length;
        } catch (bulkErr) {
          rowsInserted = bulkErr.result?.insertedCount || 0;
          rowsFailed = rows.length - rowsInserted;
        }
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
  const dbName = request.headers['x-database'];
  const { UploadLog } = getTenantModels(dbName);

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
  const dbName = request.headers['x-database'];
  const { WalkinRate, ZipZone } = getTenantModels(dbName);

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
// Base rates from the sheet are GST-inclusive — no GST is added on top.
// totalPrice === basePrice (the rate from the sheet, rounded to whole rupees).
// ---------------------------------------------------------------------------
fastify.get("/rates/quote", async (request, reply) => {
  const dbName = request.headers["x-database"];
  const { ZipZone, WalkinRate } = getTenantModels(dbName);
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
      return reply
        .status(400)
        .send({
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
          }).lean(),
          WalkinRate.findOne({
            service: svc.service,
            type: "B",
            minWt: { $lte: chargeableWt },
            maxWt: { $gte: chargeableWt },
          }).lean(),
        ]);

        for (const rd of [rateDocS, rateDocB].filter(Boolean)) {
          const zoneMap =
            rd.zones instanceof Map ? Object.fromEntries(rd.zones) : rd.zones;
          const rawPrice = zoneMap?.[zone];
          if (rawPrice === undefined || rawPrice === null || isNaN(rawPrice))
            continue;

          // Rates from the sheet are GST-inclusive — just round to whole rupees, no addition.
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
          `Quote error for service "${svc.service}":`,
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
    console.error("Quote engine error:", error);
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
    const port = process.env.PORT || 5000;
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`Server listening on http://localhost:${port}`);

    const userSockets = new Map();
    const userStatuses = new Map();

    fastify.ready((err) => {
      if (err) throw err;
      fastify.io.on("connection", (socket) => {
        console.log("Socket connected:", socket.id);
        const dbName =
          socket.handshake.headers["x-database"] ||
          socket.handshake.auth?.database;
        const { Message, Task } = getTenantModels(dbName);

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
