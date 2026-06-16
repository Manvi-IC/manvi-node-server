import mongoose from 'mongoose';

// Stores zipcode → zone mapping for Australia and Canada.
// Used by the quote engine to resolve a postcode to a delivery zone,
// which is then used to look up the per-zone rate in WalkinRate.
const zipZoneSchema = new mongoose.Schema({
  uploadId: { type: String, required: true, index: true },
  network:  { type: String },                             // SELF | ARA
  service:  { type: String, required: true, index: true },
  country:  { type: String, required: true, index: true }, // AUSTRALIA | CANADA
  zone:     { type: Number, required: true },
  zipcode:  { type: String, required: true, index: true },
  city:     { type: String },
  state:    { type: String },
}, { timestamps: true });

zipZoneSchema.index({ service: 1, country: 1, zipcode: 1 });

export default mongoose.model('ZipZone', zipZoneSchema);