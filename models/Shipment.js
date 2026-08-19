import mongoose from "mongoose";

const EventSchema = new mongoose.Schema(
  {
    eventCode: { type: String, default: "" },
    eventDescription: { type: String, required: true },
    eventDate: { type: Date, default: Date.now },
    eventTime: { type: String, default: "" },
    location: { type: String, default: "" },
  },
  { timestamps: true },
);

const ProductSchema = new mongoose.Schema(
  {
    boxNo: { type: String, default: "1" },
    description: { type: String, default: "" },
    hsnCode: { type: String, default: "" },
    unitType: { type: String, default: "PCS" },
    qty: { type: Number, default: 1 },
    unitRate: { type: Number, default: 0 },
    pieceWt: { type: Number, default: 0 },
  },
  { _id: false },
);

const ShipmentSchema = new mongoose.Schema(
  {
    awbNo: { type: String, required: true, unique: true, index: true },
    accountCode: { type: String, index: true },
    customerName: String,
    sector: String,
    destination: String,
    forwardingNo: { type: String, default: "" },
    forwarder: { type: String, default: "" },
    consignee: { type: String, default: "" },
    shipper: Object,
    receiver: Object,
    boxes: Array,
    products: { type: [ProductSchema], default: [] },
    contentDescription: String,
    invoiceValue: Number,
    invoiceNo: { type: String, default: "" },
    invoiceDate: { type: Date, default: Date.now },
    termsOfSale: { type: String, default: "DAP" },
    reasonForExport: { type: String, default: "Sale" },
    currency: String,
    service: String,
    network: String,
    chargeableWt: Number,
    basicAmt: Number,
    cgstAmt: Number,
    sgstAmt: Number,
    igstAmt: { type: Number, default: 0 },
    totalAmt: Number,
    status: { type: String, default: "BOOKED" },
    isHold: { type: Boolean, default: false },
    source: { type: String, default: "Portal" },
    manviResponse: Object,
    events: { type: [EventSchema], default: [] },
  },
  { timestamps: true },
);

export default mongoose.models.Shipment ||
  mongoose.model("Shipment", ShipmentSchema);
