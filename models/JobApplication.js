// models/JobApplication.js
import mongoose from "mongoose";

const JobApplicationSchema = new mongoose.Schema({
  jobId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Job", 
    required: false 
  },
  jobTitle: { type: String, required: true },
  fullName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  experience: { type: String, required: true },
  noticePeriod: { type: String, required: true },
  resumeUrl: { type: String, required: true },
  resumePublicId: { type: String, required: true },
  status: { 
    type: String, 
    enum: ["pending", "reviewed", "shortlisted", "rejected"], 
    default: "pending" 
  },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("JobApplication", JobApplicationSchema);