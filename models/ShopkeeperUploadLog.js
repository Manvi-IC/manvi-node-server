import mongoose from "mongoose";

// Logs every shopkeeper (bulk) rate sheet upload so the admin panel can show
// a history with status, rows inserted, deleted-old counts, etc.
// Schema mirrors UploadLog.js but is scoped to shopkeeper rate uploads.
const shopkeeperUploadLogSchema = new mongoose.Schema(
  {
    uploadId: { type: String, required: true, unique: true, index: true },
    filename: { type: String, required: true },
    fileType: { type: String, default: "shopkeeper-rates", index: true },
    status: {
      type: String,
      enum: ["processing", "completed", "failed"],
      default: "processing",
      index: true,
    },
    fileSize: { type: Number, default: 0 },
    rowsInserted: { type: Number, default: 0 },
    rowsFailed: { type: Number, default: 0 },
    deletedOld: { type: Number, default: 0 },
    errorMessage: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.models.ShopkeeperUploadLog ||
  mongoose.model("ShopkeeperUploadLog", shopkeeperUploadLogSchema);