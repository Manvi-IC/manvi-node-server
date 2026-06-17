import mongoose from 'mongoose';

// Stores one row per weight slab per service from the WALKIN rate sheet.
// zones is a Map: { "1": 785, "2": 1025, ... } — zone number → rate value
const walkinRateSchema = new mongoose.Schema({
  uploadId:  { type: String, required: true, index: true },
  shipper:   { type: String },           // e.g. "WALKIN 20260525"
  network:   { type: String },           // SELF | ARA | DHL | UPS | FED
  service:   { type: String, required: true, index: true }, // e.g. "EX DEL AUS DIRECT"
  type:      { type: String, enum: ['S', 'B', 'D'], required: true }, // S=slab, B=per/kg, D=duty
  minWt:     { type: Number, required: true },
  maxWt:     { type: Number, required: true },
  zones:     { type: Map, of: Number },  // { "1": 785, "2": 1025 }
}, { timestamps: true });

walkinRateSchema.index({ service: 1, minWt: 1, maxWt: 1 });

export default mongoose.model('WalkinRate', walkinRateSchema);