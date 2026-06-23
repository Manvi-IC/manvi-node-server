// models/QuoteEnquiry.js
import mongoose from "mongoose";

const QuoteEnquirySchema = new mongoose.Schema(
  {
    // Contact details
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },

    // Quote details
    destination: { type: String, required: true },
    zoningCountry: { type: String, default: "" },
    zipcode: { type: String, default: "" },
    actualWt: { type: Number, required: true },
    volWt: { type: Number, default: 0 },
    chargeableWt: { type: Number, required: true },

    // Dimensions
    length: { type: Number, default: 0 },
    breadth: { type: Number, default: 0 },
    height: { type: Number, default: 0 },

    // Selected service
    service: { type: String, required: true },
    network: { type: String, default: "" },
    zone: { type: String, default: "" },
    rateType: { type: String, default: "" },
    totalPrice: { type: Number, required: true },
    tat: { type: String, default: "" },

    // Status
    status: {
      type: String,
      enum: ["new", "contacted", "converted", "closed"],
      default: "new",
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("QuoteEnquiry", QuoteEnquirySchema);