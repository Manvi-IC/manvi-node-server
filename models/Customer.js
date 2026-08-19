import mongoose from "mongoose";

const CustomerSchema = new mongoose.Schema(
  {
    customerId: { type: String, unique: true, index: true },
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, required: true },
    company: { type: String, default: "N/A" },
    address: { type: String, default: "" },
    gstin: { type: String, default: "N/A" },
    passwordHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    balance: { type: Number, default: 50000 },
  },
  { timestamps: true },
);

export default mongoose.models.Customer ||
  mongoose.model("Customer", CustomerSchema);
