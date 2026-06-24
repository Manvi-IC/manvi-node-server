// models/Job.js
import mongoose from "mongoose";

const JobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  department: { type: String, required: true },
  location: { type: String, required: true },
  tag: { type: String, required: true },
  description: { type: String, required: true },
  responsibilities: { type: [String], required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

JobSchema.index({ createdAt: -1 });
JobSchema.index({ isActive: 1, createdAt: -1 });

export default mongoose.model("Job", JobSchema);