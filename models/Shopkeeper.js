import mongoose from "mongoose";

// Stores one shopkeeper (bulk rates) account.
// A shopkeeper must be APPROVED before they can fetch bulk rates.
const shopkeeperSchema = new mongoose.Schema(
  {
    shopkeeperId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: { type: String, required: true, trim: true, index: true },
    company: { type: String, default: "", trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    pincode: { type: String, default: "", trim: true },
    gstin: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "APPROVED",
      index: true,
    },
    notes: { type: String, default: "" },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

shopkeeperSchema.index({ email: 1, status: 1 });

export default mongoose.models.Shopkeeper ||
  mongoose.model("Shopkeeper", shopkeeperSchema);