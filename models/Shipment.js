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

// Payment Details Schema
const PaymentDetailsSchema = new mongoose.Schema(
  {
    merchantTxnNo: { type: String },
    tranCtx: { type: String },
    txnID: { type: String },
    paymentID: { type: String },
    paymentMode: { type: String },
    paymentSubInstType: { type: String },
    amount: { type: Number },
    responseCode: { type: String },
    paymentDateTime: { type: String },
    authCode: { type: String },
    status: { 
      type: String, 
      enum: ["INITIATED", "SUCCESS", "FAILED", "PENDING", "REFUNDED", "VOIDED"],
      default: "PENDING",
    },
    initiatedAt: { type: Date },
    completedAt: { type: Date },
    refundStatus: { 
      type: String, 
      enum: ["NONE", "REFUNDED", "PARTIAL", "FAILED"],
      default: "NONE",
    },
    refundAmount: { type: Number },
    refundTxnId: { type: String },
    refundDateTime: { type: Date },
    voidStatus: { 
      type: String, 
      enum: ["NONE", "VOIDED"],
      default: "NONE",
    },
    voidDateTime: { type: Date },
    responseData: { type: Object },
  },
  { _id: false },
);

const ShipmentSchema = new mongoose.Schema(
  {
    // Existing fields
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

    // NEW PAYMENT FIELDS
    paymentStatus: { 
      type: String, 
      enum: ["PENDING", "PAID", "FAILED", "REFUNDED", "PARTIAL"],
      default: "PENDING",
    },
    paymentDetails: { type: PaymentDetailsSchema, default: () => ({}) },
    confirmedAt: { type: Date },
    quoteEnquiryId: { type: mongoose.Schema.Types.ObjectId, ref: "QuoteEnquiry" },
  },
  { timestamps: true },
);

// Indexes
ShipmentSchema.index({ "paymentDetails.merchantTxnNo": 1 });
ShipmentSchema.index({ paymentStatus: 1 });

// Methods
ShipmentSchema.methods.addEvent = function(eventCode, eventDescription, location = "") {
  this.events.push({
    eventCode,
    eventDescription,
    eventDate: new Date(),
    location,
  });
  return this.save();
};

ShipmentSchema.methods.markPaid = function(txnData) {
  this.paymentStatus = "PAID";
  this.paymentDetails = {
    ...this.paymentDetails,
    ...txnData,
    status: "SUCCESS",
    completedAt: new Date(),
  };
  this.status = "BOOKED";
  this.isHold = false;
  this.confirmedAt = new Date();
  
  this.events.push({
    eventCode: "PAY",
    eventDescription: `Payment confirmed: ${txnData.txnID || "N/A"}`,
    eventDate: new Date(),
    location: "Online",
  });
  
  return this.save();
};

ShipmentSchema.methods.markPaymentFailed = function(reason) {
  this.paymentStatus = "FAILED";
  this.status = "PAYMENT_FAILED";
  
  this.events.push({
    eventCode: "PAY_FAIL",
    eventDescription: `Payment failed: ${reason || "Unknown error"}`,
    eventDate: new Date(),
    location: "Online",
  });
  
  return this.save();
};

export default mongoose.models.Shipment ||
  mongoose.model("Shipment", ShipmentSchema);