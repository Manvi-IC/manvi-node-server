import mongoose from 'mongoose';

const siteSettingsSchema = new mongoose.Schema({
  marqueeText: {
    type: String,
    default: "🎉 Send Shipment to USA @ ₹679 per KG  •  T&C Applied  •  🎊 Send Shipment to USA @ ₹679 per KG  •  T&C Applied  •  🎉 Send Shipment to USA @ ₹679 per KG  •  T&C Applied  •",
  },
  offerTitle: {
    type: String,
    default: "Limited-Time Offer",
  },
  offerSubtitle: {
    type: String,
    default: "₹679/kg to USA — ends soon",
  },
  offerEndDate: {
    type: Date,
    default: () => new Date("2026-06-20T23:59:59"),
  },
}, { timestamps: true });

const SiteSettings = mongoose.model('SiteSettings', siteSettingsSchema);

export default SiteSettings;
