import mongoose from "mongoose";

// Stores one row per weight slab per service from the SHOPKEEPER (bulk) rate sheet.
// Structure identical to WalkinRate, but lives in a separate collection so
// bulk pricing is completely independent from the regular (walk-in) pricing.
const shopkeeperRateSchema = new mongoose.Schema(
  {
    uploadId: { type: String, required: true, index: true },
    shipper: { type: String },
    network: { type: String },
    service: { type: String, required: true, index: true },
    type: { type: String, enum: ["S", "B", "D"], required: true },
    minWt: { type: Number, required: true },
    maxWt: { type: Number, required: true },
    zones: { type: Map, of: Number },
  },
  { timestamps: true },
);

shopkeeperRateSchema.index({ service: 1, minWt: 1, maxWt: 1 });
shopkeeperRateSchema.index({ service: 1, type: 1, minWt: 1, maxWt: 1 });

export default mongoose.models.ShopkeeperRate ||
  mongoose.model("ShopkeeperRate", shopkeeperRateSchema);