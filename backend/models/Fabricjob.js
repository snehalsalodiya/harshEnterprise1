const mongoose = require("mongoose");  
const fabricJobSchema = new mongoose.Schema({   
  jobId: { type: String, unique: true },   
  partyName: String,
  fabricType: String,
  quantity: Number,
  rate: Number,
  stage: { 
    type: String,
    enum: ["raw", "coated", "printed", "washed", "packed", "delivered"],  
    default: "raw"  
  },
  mobileNumber: {
  type: String,
  required: true,
},

  deliveryDate: Date }, { timestamps: true });  

module.exports = mongoose.model("FabricJob", fabricJobSchema);
