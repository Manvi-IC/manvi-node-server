import mongoose from 'mongoose';

const uploadLogSchema = new mongoose.Schema({
  uploadId:      { type: String, required: true, unique: true },
  filename:      { type: String, required: true },
  fileType:      { type: String, enum: ['rates', 'zipcodes'], required: true },
  status:        { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing' },
  rowsInserted:  { type: Number, default: 0 },
  rowsFailed:    { type: Number, default: 0 },
  errorMessage:  { type: String },
  fileSize:      { type: Number }, // bytes
}, { timestamps: true });

export default mongoose.model('UploadLog', uploadLogSchema);