// models/ServiceArea.js
import mongoose from "mongoose";

const ServiceAreaSchema = new mongoose.Schema(
  {
    city: {
      type: String,
      required: true,
      trim: true,
    },
    state: {
      type: String,
      required: true,
      trim: true,
    },
    country: {
      type: String,
      required: true,
      trim: true,
      default: "India",
    },
    pincode: {
      type: String,
      trim: true,
      default: "",
    },
    pickupAvailable: {
      type: Boolean,
      default: false,
    },
    dropoffAvailable: {
      type: Boolean,
      default: false,
    },
    pickupDays: {
      // e.g. "Mon-Sat", "Mon, Wed, Fri"
      type: String,
      default: "",
    },
    dropoffDays: {
      type: String,
      default: "",
    },
    pickupTimeSlot: {
      // e.g. "9 AM – 6 PM"
      type: String,
      default: "",
    },
    dropoffTimeSlot: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Text index for fuzzy search on city / state
ServiceAreaSchema.index({ city: "text", state: "text", pincode: "text" });
// Regular indexes for query performance
ServiceAreaSchema.index({ city: 1, state: 1 });
ServiceAreaSchema.index({ pincode: 1 });

export default mongoose.models.ServiceArea ||
  mongoose.model("ServiceArea", ServiceAreaSchema);