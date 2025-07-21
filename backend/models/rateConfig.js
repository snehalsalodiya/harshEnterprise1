const mongoose = require('mongoose');

const rateConfigSchema = new mongoose.Schema({
  coatingRate: {
    type: Number,
    required: true
  },
  washingRate: {
    type: Number,
    required: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('RateConfig', rateConfigSchema);
