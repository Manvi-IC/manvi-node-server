import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    url: { type: String, default: "" },
    type: { type: String, default: "" },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const commentSchema = new mongoose.Schema(
  {
    text: { type: String },
    userId: { type: String },
    userName: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    priority: {
      type: String,
      enum: ["high", "medium", "low"],
      default: "medium",
    },
    status: {
      type: String,
      enum: ["pending", "in-progress", "completed", "cancelled"],
      default: "pending",
    },
    assignedTo: {
      userId: {
        type: String,
        required: true,
      },
      userName: {
        type: String,
        required: true,
      },
      department: {
        type: String,
        required: true,
      },
    },
    assignedBy: {
      userId: {
        type: String,
        required: true,
      },
      userName: {
        type: String,
        required: true,
      },
      department: {
        type: String,
        required: true,
      },
    },
    dueDate: {
      type: Date,
      required: true,
    },
    completedAt: {
      type: Date,
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    comments: {
      type: [commentSchema],
      default: [],
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fast unread count fetching
taskSchema.index({ "assignedTo.userId": 1, isRead: 1, status: 1 });

const Task = mongoose.models.Task || mongoose.model("Task", taskSchema);
export default Task;
