import mongoose from "mongoose";

const siteSettingsSchema = new mongoose.Schema({
  marqueeText: { type: String, default: "" },
  showMarquee: { type: Boolean, default: true },
  offerTitle: { type: String, default: "Limited-Time Offer" },
  offerSubtitle: { type: String, default: "₹679/kg to USA — ends soon" },
  offerEndDate: { type: Date, default: new Date("2026-06-20T23:59:59") },
  showOffer: { type: Boolean, default: true },
  countryServiceMapping: {
    type: [{
      country: String,
      services: [String]
    }],
    default: [
      { country: "Australia", services: ["DHL", "ARAMEX", "UPS", "FEDEX", "SELF - DUTY Paid"] },
      { country: "Canada", services: ["DHL", "ARAMEX", "UPS", "FEDEX", "SELF - DUTY Paid"] },
      { country: "France", services: ["DHL", "ARAMEX", "UPS", "FEDEX", "SELF - DUTY Paid"] },
      { country: "Spain", services: ["DHL", "ARAMEX", "UPS", "FEDEX", "SELF - DUTY Paid"] },
      { country: "UK", services: ["DHL", "ARAMEX", "UPS", "FEDEX", "SELF - DUTY Paid"] },
      { country: "USA", services: ["DHL", "ARAMEX", "UPS", "FEDEX", "SELF - DUTY Paid"] }
    ]
  }
}, { timestamps: true });

const SiteSettings = mongoose.models.SiteSettings || mongoose.model("SiteSettings", siteSettingsSchema);
export default SiteSettings;
