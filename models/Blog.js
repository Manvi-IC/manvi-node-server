// models/Blog.js
import mongoose from "mongoose";

const BlogBlockSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ["paragraph", "subheading", "list", "callout", "image", "heading", "divider", "slideshow"], 
    required: true 
  },
  text: { type: String },
  items: { type: [String] },
  style: { type: String }, // e.g. "bullet", "numbered", "h2", "h3", "h4"
  src: { type: String },
  alt: { type: String },
  caption: { type: String },
  layout: { type: String, default: "" }, // For paragraph image alignment: "left-image", "right-image", etc.
  images: [{
    src: { type: String },
    alt: { type: String },
    caption: { type: String }
  }]
});

const BlogSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true },
  category: { type: String, required: true },
  icon: { type: String, default: "📝" },
  tag: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  readTime: { type: String, default: "5 min" },
  thumbClass: { type: String, default: "" },
  featured: { type: Boolean, default: false },
  publishedDate: { type: String, required: true },
  bannerImage: { type: String, default: "" },
  author: {
    name: { type: String, default: "Manvi Logistics Team" },
    avatarInitials: { type: String, default: "ML" }
  },
  content: { type: [BlogBlockSchema], default: [] }
}, { timestamps: true });

export default mongoose.model("Blog", BlogSchema);

